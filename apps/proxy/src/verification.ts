/**
 * URL ownership verification (anti-squatting). A publisher proves control of the
 * upstream by serving their Stent account token at `{origin}/stent-verification.txt`.
 * An endpoint must pass this check (verified = true) before the proxy serves it.
 *
 * SSRF hardening: the verify request is a server-side fetch to a publisher-supplied
 * host, so before fetching we resolve the hostname and refuse any address that is
 * not a public, routable destination — loopback, RFC1918, link-local, cloud
 * metadata, CGNAT, ULA, multicast, and `localhost` by name. This stops the verify
 * (and, by extension, registration) path from being used to probe internal hosts.
 *
 * `fetchImpl` / `lookupImpl` are injectable so the logic is unit-testable offline.
 */
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";

export interface VerifyResult {
  verified: boolean;
  /** Why it failed (when not verified). */
  reason?: string;
  /** The token actually found at the URL (trimmed), when fetched. */
  found?: string;
  /** The verification URL fetched by the proxy. */
  verificationUrl?: string;
  /** HTTP status returned by the verification URL, when a response was received. */
  httpStatus?: number;
}

const VERIFICATION_PATH = "/stent-verification.txt";

// ── SSRF guard ──────────────────────────────────────────────────────────────

export interface LookupAddr {
  address: string;
  family: number;
}
export type LookupFn = (hostname: string) => Promise<LookupAddr[]>;

const realLookup: LookupFn = async (hostname) => {
  const r = await dnsLookup(hostname, { all: true });
  return r.map((x) => ({ address: x.address, family: x.family }));
};

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

function inNet4(ipInt: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base);
  if (b === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((b & mask) >>> 0);
}

/**
 * True if an IP literal points somewhere the server must never be made to reach.
 * Covers IPv4 and IPv6 (incl. IPv4-mapped). Fails closed on anything unparseable.
 */
export function isBlockedIp(addr: string): boolean {
  let ip = addr.trim().toLowerCase();
  const zone = ip.indexOf("%"); // strip IPv6 zone id, e.g. fe80::1%eth0
  if (zone >= 0) ip = ip.slice(0, zone);
  if (ip.startsWith("::ffff:") && ip.includes(".")) ip = ip.slice("::ffff:".length); // unwrap mapped

  const fam = isIP(ip);
  if (fam === 4) {
    const n = ipv4ToInt(ip);
    if (n === null) return true;
    return (
      inNet4(n, "0.0.0.0", 8) || // "this host"
      inNet4(n, "10.0.0.0", 8) || // RFC1918
      inNet4(n, "100.64.0.0", 10) || // CGNAT (RFC6598) — some metadata services
      inNet4(n, "127.0.0.0", 8) || // loopback
      inNet4(n, "169.254.0.0", 16) || // link-local — incl. 169.254.169.254 metadata
      inNet4(n, "172.16.0.0", 12) || // RFC1918
      inNet4(n, "192.0.0.0", 24) || // IETF protocol assignments
      inNet4(n, "192.168.0.0", 16) || // RFC1918
      inNet4(n, "198.18.0.0", 15) || // benchmarking
      inNet4(n, "224.0.0.0", 4) || // multicast
      inNet4(n, "240.0.0.0", 4) // reserved
    );
  }
  if (fam === 6) {
    if (ip === "::" || ip === "::1") return true; // unspecified / loopback
    if (/^fe[89ab]/.test(ip)) return true; // fe80::/10 link-local
    if (/^f[cd]/.test(ip)) return true; // fc00::/7 unique-local
    if (/^ff/.test(ip)) return true; // ff00::/8 multicast
    return false;
  }
  return true; // not a valid IP → block
}

function normalizeHostname(h: string): string {
  return h.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isBlockedHostname(h: string): boolean {
  const host = normalizeHostname(h);
  return host === "localhost" || host.endsWith(".localhost");
}

function isLoopbackHostname(h: string): boolean {
  const host = h.trim().toLowerCase().replace(/\.$/, "");
  return host === "localhost" || host.endsWith(".localhost");
}

function isLoopbackIpLiteral(h: string): boolean {
  const host = normalizeHostname(h);
  return host === "127.0.0.1" || host === "::1";
}

/**
 * Resolve `hostname` and confirm every address it maps to is public/routable.
 * Returns `{ ok: false, reason: "blocked_target" }` for any disallowed target.
 */
export async function resolvePublicHost(
  hostname: string,
  lookup: LookupFn = realLookup
): Promise<{ ok: true; addresses: LookupAddr[] } | { ok: false; reason: string }> {
  const host = normalizeHostname(hostname);
  if (isBlockedHostname(host)) return { ok: false, reason: "blocked_target" };

  if (isIP(host)) {
    return isBlockedIp(host)
      ? { ok: false, reason: "blocked_target" }
      : { ok: true, addresses: [{ address: host, family: isIP(host) }] };
  }

  let addrs: LookupAddr[];
  try {
    addrs = await lookup(host);
  } catch {
    return { ok: false, reason: "unresolvable" };
  }
  if (addrs.length === 0) return { ok: false, reason: "unresolvable" };
  // Defensive: a single private address anywhere in the set blocks the target.
  for (const a of addrs) {
    if (isBlockedIp(a.address)) return { ok: false, reason: "blocked_target" };
  }
  return { ok: true, addresses: addrs };
}

export async function assertPublicHost(
  hostname: string,
  lookup: LookupFn = realLookup
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const resolved = await resolvePublicHost(hostname, lookup);
  return resolved.ok ? { ok: true } : resolved;
}

export interface PublicFetchResult {
  status: number;
  contentType: string;
  body: Buffer;
  headers: Record<string, string>;
}

export class PublicFetchError extends Error {
  constructor(
    public readonly reason: string,
    public readonly detail?: { code?: string; message?: string }
  ) {
    super(reason);
  }
}

export interface PublicFetchTrace {
  dns: Array<{
    hostname: string;
    ok: boolean;
    addresses?: LookupAddr[];
    reason?: string;
  }>;
  attempts: Array<{
    url: string;
    address?: string;
    family?: number;
    status: "connected" | "failed";
    errorReason?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
  redirects: Array<{ from: string; to: string; status: number }>;
}

interface PublicFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer;
  timeoutMs?: number;
  lookupImpl?: LookupFn;
  allowInsecureLoopback?: boolean;
  maxRedirects?: number;
  trace?: PublicFetchTrace;
}

function emptyTrace(): PublicFetchTrace {
  return { dns: [], attempts: [], redirects: [] };
}

export async function fetchPublicUrl(
  targetUrl: string,
  opts: PublicFetchOptions = {}
): Promise<PublicFetchResult> {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new PublicFetchError("invalid_target_url");
  }
  return fetchPublicUrlInner(url, opts, opts.maxRedirects ?? 5, new Set([url.toString()]));
}

async function fetchPublicUrlInner(
  url: URL,
  opts: PublicFetchOptions,
  redirectsLeft: number,
  seenUrls: Set<string>
): Promise<PublicFetchResult> {
  const host = url.hostname;
  const isDevLoopback =
    opts.allowInsecureLoopback && (isLoopbackHostname(host) || isLoopbackIpLiteral(host));
  if (url.protocol !== "https:" && !(isDevLoopback && url.protocol === "http:")) {
    throw new PublicFetchError("blocked_target");
  }

  let pinned: LookupAddr[] | undefined;
  if (!isDevLoopback) {
    const resolved = await resolvePublicHost(host, opts.lookupImpl);
    opts.trace?.dns.push(
      resolved.ok
        ? { hostname: host, ok: true, addresses: resolved.addresses }
        : { hostname: host, ok: false, reason: resolved.reason }
    );
    if (!resolved.ok) throw new PublicFetchError(resolved.reason);
    pinned = resolved.addresses;
  }

  const result = await requestPinned(url, opts, pinned);
  const location = result.headers.location;
  if (
    result.status >= 300 &&
    result.status < 400 &&
    location
  ) {
    if (redirectsLeft <= 0) throw new PublicFetchError("redirect_loop");
    const next = new URL(location, url);
    const nextKey = next.toString();
    opts.trace?.redirects.push({ from: url.toString(), to: nextKey, status: result.status });
    if (seenUrls.has(nextKey)) throw new PublicFetchError("redirect_loop");
    seenUrls.add(nextKey);
    const method = opts.method?.toUpperCase() ?? "GET";
    const shouldDropBody =
      result.status === 303 || ((result.status === 301 || result.status === 302) && method === "POST");
    return fetchPublicUrlInner(
      next,
      shouldDropBody
        ? { ...opts, method: "GET", body: undefined }
        : opts,
      redirectsLeft - 1,
      seenUrls
    );
  }
  return {
    status: result.status,
    contentType: result.headers["content-type"] ?? "application/octet-stream",
    body: result.body,
    headers: result.headers,
  };
}

function requestPinned(
  url: URL,
  opts: PublicFetchOptions,
  pinned?: LookupAddr[]
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const candidates = pinned && pinned.length > 0 ? pinned : [undefined];
  let lastError: PublicFetchError | undefined;

  const run = async () => {
    for (const candidate of candidates) {
      try {
        return await requestPinnedOnce(url, opts, candidate);
      } catch (err) {
        const normalized = normalizeRequestError(err, url.protocol);
        lastError = normalized;
        opts.trace?.attempts.push({
          url: url.toString(),
          address: candidate?.address,
          family: candidate?.family,
          status: "failed",
          errorReason: normalized.reason,
          errorCode: normalized.detail?.code,
          errorMessage: normalized.detail?.message,
        });
        if (!isRetryableConnectionFailure(normalized.reason)) throw normalized;
      }
    }
    throw lastError ?? new PublicFetchError("connection_failed");
  };

  return run();
}

function requestPinnedOnce(
  url: URL,
  opts: PublicFetchOptions,
  pinned?: LookupAddr
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    const requestOpts: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: opts.method ?? "GET",
      headers: opts.headers,
      timeout: opts.timeoutMs ?? 5000,
      lookup: pinned
        ? createPinnedLookup(pinned)
        : undefined,
    };
    const req = requester(requestOpts, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        opts.trace?.attempts.push({
          url: url.toString(),
          address: pinned?.address,
          family: pinned?.family,
          status: "connected",
        });
        resolve({
          status: res.statusCode ?? 0,
          headers: lowerHeaders(res.headers),
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("error", (err) => reject(normalizeRequestError(err, url.protocol)));
    req.on("timeout", () => req.destroy(new PublicFetchError("connection_timeout")));
    if (opts.body && opts.body.length > 0) req.write(opts.body);
    req.end();
  });
}

export function createPinnedLookup(pinned: LookupAddr) {
  return (
    _hostname: string,
    options: { all?: boolean } | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void),
    callback?:
      | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void)
      | ((err: NodeJS.ErrnoException | null, addresses: LookupAddr[]) => void)
  ) => {
    const cb = (typeof options === "function" ? options : callback) as
      | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void)
      | ((err: NodeJS.ErrnoException | null, addresses: LookupAddr[]) => void);
    const wantsAll = typeof options === "object" && options !== null && options.all === true;
    if (wantsAll) {
      (cb as (err: NodeJS.ErrnoException | null, addresses: LookupAddr[]) => void)(null, [pinned]);
      return;
    }
    (cb as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(
      null,
      pinned.address,
      pinned.family
    );
  };
}

function isRetryableConnectionFailure(reason: string): boolean {
  return reason === "connection_failed" || reason === "connection_timeout" || reason === "tls_failure";
}

function normalizeRequestError(err: unknown, protocol: string): PublicFetchError {
  if (err instanceof PublicFetchError) return err;
  const e = err as NodeJS.ErrnoException;
  const code = typeof e?.code === "string" ? e.code : undefined;
  const name = typeof e?.name === "string" ? e.name : undefined;
  const message = e?.message ? String(e.message) : String(err);
  const detail = { code, message };
  if (
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    code === "ABORT_ERR" ||
    name === "AbortError" ||
    /timeout/i.test(message)
  ) {
    return new PublicFetchError("connection_timeout", detail);
  }
  if (
    protocol === "https:" &&
    (code === "EPROTO" ||
      code === "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE" ||
      code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
      code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
      code === "SELF_SIGNED_CERT_IN_CHAIN" ||
      code === "CERT_HAS_EXPIRED" ||
      code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      /TLS|SSL|certificate|cert/i.test(message))
  ) {
    return new PublicFetchError("tls_failure", detail);
  }
  return new PublicFetchError("connection_failed", detail);
}

function lowerHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
    else if (Array.isArray(value)) out[key.toLowerCase()] = value.join(", ");
  }
  return out;
}

// ── Verification ──────────────────────────────────────────────────────────────

export interface VerifyOwnershipOpts {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupFn;
  allowInsecureLoopback?: boolean;
}

/**
 * Verify ownership via the domain-root `stent-verification.txt` file, or —
 * when that fails — via an `X-Stent-Verify: <token>` header on the target
 * URL's own response. The header path exists for publishers who can't add a
 * route at their domain root (shared hosting, managed API gateways, subpath
 * deployments): they can return the token as a header on the exact endpoint
 * Stent is paywalling instead. Both paths reuse the same SSRF-guarded fetch;
 * the header attempt is skipped only when the file already verified.
 */
export async function verifyOwnership(
  targetUrl: string,
  expectedToken: string,
  opts: VerifyOwnershipOpts = {}
): Promise<VerifyResult> {
  const fileResult = await verifyViaFile(targetUrl, expectedToken, opts);
  if (fileResult.verified) return fileResult;

  const headerResult = await verifyViaHeader(targetUrl, expectedToken, opts);
  return headerResult.verified ? headerResult : fileResult;
}

async function verifyViaFile(
  targetUrl: string,
  expectedToken: string,
  opts: VerifyOwnershipOpts
): Promise<VerifyResult> {
  const expected = expectedToken.trim();
  const log = {
    event: "endpoint_verification",
    targetUrl,
    verificationUrl: "",
    dnsResult: [] as PublicFetchTrace["dns"],
    connectionStatus: [] as PublicFetchTrace["attempts"],
    redirects: [] as PublicFetchTrace["redirects"],
    httpStatus: undefined as number | undefined,
    responseBody: undefined as string | undefined,
    responseBodyTruncated: false,
    parsedToken: undefined as string | undefined,
    expectedToken: expected,
    resultReason: undefined as string | undefined,
    failureReason: undefined as string | undefined,
    verified: false,
  };

  const finish = (result: VerifyResult): VerifyResult => {
    log.resultReason = result.reason;
    log.failureReason = result.verified ? undefined : result.reason;
    log.verified = result.verified;
    console.info("[verification]", JSON.stringify(log));
    return result;
  };

  if (!expected) return finish({ verified: false, reason: "no_expected_token" });

  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return finish({ verified: false, reason: "invalid_target_url" });
  }
  const verificationUrl = `${url.origin}${VERIFICATION_PATH}`;
  log.verificationUrl = verificationUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  const trace = emptyTrace();
  try {
    let status: number;
    let text: string;
    if (opts.fetchImpl) {
      // Tests and explicit callers can inject fetch; production uses the pinned
      // request path below to avoid DNS rebinding between validation and connect.
      const guard = await resolvePublicHost(url.hostname, opts.lookupImpl);
      log.dnsResult.push(
        guard.ok
          ? { hostname: url.hostname, ok: true, addresses: guard.addresses }
          : { hostname: url.hostname, ok: false, reason: guard.reason }
      );
      if (!guard.ok) return finish({ verified: false, reason: verificationReason(guard.reason), verificationUrl });
      const res = await opts.fetchImpl(verificationUrl, { signal: controller.signal });
      status = res.status;
      text = await res.text();
      log.connectionStatus.push({ url: verificationUrl, status: "connected" });
    } else {
      const res = await fetchPublicUrl(verificationUrl, {
        timeoutMs: opts.timeoutMs ?? 5000,
        lookupImpl: opts.lookupImpl,
        allowInsecureLoopback: opts.allowInsecureLoopback,
        trace,
      });
      status = res.status;
      text = res.body.toString("utf8");
      log.dnsResult = trace.dns;
      log.connectionStatus = trace.attempts;
      log.redirects = trace.redirects;
    }
    log.httpStatus = status;
    log.responseBody = text.length > 4096 ? text.slice(0, 4096) : text;
    log.responseBodyTruncated = text.length > 4096;
    if (status < 200 || status >= 300) {
      return finish({ verified: false, reason: httpFailureReason(status), verificationUrl, httpStatus: status });
    }
    const found = text.replace(/^\uFEFF/, "").trim();
    log.parsedToken = found;
    if (!found) {
      return finish({
        verified: false,
        reason: "empty_verification_file",
        found,
        verificationUrl,
        httpStatus: status,
      });
    }
    return found === expected
      ? finish({ verified: true, reason: "verification_successful", found, verificationUrl, httpStatus: status })
      : finish({ verified: false, reason: "token_mismatch", found, verificationUrl, httpStatus: status });
  } catch (err) {
    log.dnsResult = trace.dns.length ? trace.dns : log.dnsResult;
    log.connectionStatus = trace.attempts.length ? trace.attempts : log.connectionStatus;
    log.redirects = trace.redirects.length ? trace.redirects : log.redirects;
    if (err instanceof PublicFetchError) {
      if (log.connectionStatus.length === 0 && isConnectionReason(err.reason)) {
        log.connectionStatus.push({
          url: verificationUrl,
          status: "failed",
          errorReason: err.reason,
          errorCode: err.detail?.code,
          errorMessage: err.detail?.message,
        });
      }
      return finish({ verified: false, reason: verificationReason(err.reason), verificationUrl });
    }
    const normalized = normalizeRequestError(err, url.protocol);
    if (log.connectionStatus.length === 0 && isConnectionReason(normalized.reason)) {
      log.connectionStatus.push({
        url: verificationUrl,
        status: "failed",
        errorReason: normalized.reason,
        errorCode: normalized.detail?.code,
        errorMessage: normalized.detail?.message,
      });
    }
    return finish({ verified: false, reason: verificationReason(normalized.reason), verificationUrl });
  } finally {
    clearTimeout(timer);
  }
}

const VERIFY_HEADER = "x-stent-verify";

/**
 * Verify ownership via an `X-Stent-Verify: <token>` header on the target
 * URL's own response. Uses the same SSRF-guarded fetch as the file check.
 */
async function verifyViaHeader(
  targetUrl: string,
  expectedToken: string,
  opts: VerifyOwnershipOpts
): Promise<VerifyResult> {
  const expected = expectedToken.trim();

  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return { verified: false, reason: "invalid_target_url" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  try {
    let status: number;
    let headerValue: string | undefined;
    if (opts.fetchImpl) {
      const guard = await resolvePublicHost(url.hostname, opts.lookupImpl);
      if (!guard.ok) return { verified: false, reason: verificationReason(guard.reason) };
      const res = await opts.fetchImpl(targetUrl, { signal: controller.signal });
      status = res.status;
      // A test double or minimal fetch shim may not implement Headers — treat
      // a missing accessor the same as the header being absent.
      headerValue = (res as { headers?: { get?(name: string): string | null } }).headers?.get?.(
        VERIFY_HEADER
      ) ?? undefined;
    } else {
      const res = await fetchPublicUrl(targetUrl, {
        timeoutMs: opts.timeoutMs ?? 5000,
        lookupImpl: opts.lookupImpl,
        allowInsecureLoopback: opts.allowInsecureLoopback,
      });
      status = res.status;
      headerValue = res.headers[VERIFY_HEADER];
    }
    if (status < 200 || status >= 300) {
      return { verified: false, reason: httpFailureReason(status), verificationUrl: targetUrl, httpStatus: status };
    }
    const found = headerValue?.trim();
    if (!found) {
      return { verified: false, reason: "header_not_present", verificationUrl: targetUrl, httpStatus: status };
    }
    return found === expected
      ? { verified: true, reason: "header_verified", found, verificationUrl: targetUrl, httpStatus: status }
      : { verified: false, reason: "header_mismatch", found, verificationUrl: targetUrl, httpStatus: status };
  } catch (err) {
    if (err instanceof PublicFetchError) {
      return { verified: false, reason: verificationReason(err.reason) };
    }
    const normalized = normalizeRequestError(err, url.protocol);
    return { verified: false, reason: verificationReason(normalized.reason) };
  } finally {
    clearTimeout(timer);
  }
}

function verificationReason(reason: string): string {
  if (reason === "unreachable") return "connection_failed";
  return reason === "unresolvable" ? "dns_lookup_failed" : reason;
}

function isConnectionReason(reason: string): boolean {
  return reason === "connection_failed" || reason === "connection_timeout" || reason === "tls_failure";
}

function httpFailureReason(status: number): string {
  if (status === 404) return "http_404";
  if (status >= 500 && status <= 599) return "http_5xx";
  if (status >= 400 && status <= 499) return "http_4xx";
  if (status >= 300 && status <= 399) return "http_3xx";
  return `http_${status}`;
}
