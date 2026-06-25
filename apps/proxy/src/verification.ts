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

export interface VerifyResult {
  verified: boolean;
  /** Why it failed (when not verified). */
  reason?: string;
  /** The token actually found at the URL (trimmed), when fetched. */
  found?: string;
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

function isBlockedHostname(h: string): boolean {
  const host = h.trim().toLowerCase().replace(/\.$/, "");
  return host === "localhost" || host.endsWith(".localhost");
}

/**
 * Resolve `hostname` and confirm every address it maps to is public/routable.
 * Returns `{ ok: false, reason: "blocked_target" }` for any disallowed target.
 */
export async function assertPublicHost(
  hostname: string,
  lookup: LookupFn = realLookup
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (isBlockedHostname(hostname)) return { ok: false, reason: "blocked_target" };

  if (isIP(hostname)) {
    return isBlockedIp(hostname) ? { ok: false, reason: "blocked_target" } : { ok: true };
  }

  let addrs: LookupAddr[];
  try {
    addrs = await lookup(hostname);
  } catch {
    return { ok: false, reason: "unresolvable" };
  }
  if (addrs.length === 0) return { ok: false, reason: "unresolvable" };
  // Defensive: a single private address anywhere in the set blocks the target.
  for (const a of addrs) {
    if (isBlockedIp(a.address)) return { ok: false, reason: "blocked_target" };
  }
  return { ok: true };
}

// ── Verification ──────────────────────────────────────────────────────────────

export async function verifyOwnership(
  targetUrl: string,
  expectedToken: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; lookupImpl?: LookupFn } = {}
): Promise<VerifyResult> {
  const expected = expectedToken.trim();
  if (!expected) return { verified: false, reason: "no_expected_token" };

  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return { verified: false, reason: "invalid_target_url" };
  }

  // SSRF guard — resolve + validate the host BEFORE any request leaves the server.
  const guard = await assertPublicHost(url.hostname, opts.lookupImpl);
  if (!guard.ok) return { verified: false, reason: guard.reason };

  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await doFetch(`${url.origin}${VERIFICATION_PATH}`, { signal: controller.signal });
    if (!res.ok) return { verified: false, reason: `fetch_status_${res.status}` };
    const found = (await res.text()).trim();
    return found === expected
      ? { verified: true, found }
      : { verified: false, reason: "token_mismatch", found };
  } catch {
    return { verified: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
