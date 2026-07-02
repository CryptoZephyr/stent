import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { endpointCache } from "./endpointCache";
import { rateLimiter } from "./rateLimiter";
import { getPaymentHandler } from "./gateway";
import { runWithRequestContext, type ProxyRequest } from "./requestContext";
import { createRegistrationRouter } from "./registration";

const TRUST_PROXY = process.env.TRUST_PROXY_HOPS
  ? Number(process.env.TRUST_PROXY_HOPS)
  : 1;

export function createServer() {
  const app = express();
  app.disable("x-powered-by");
  // Behind a PaaS load balancer (Railway), trust only the known front proxy hop
  // so clients cannot spoof req.ip by supplying arbitrary X-Forwarded-For values.
  app.set("trust proxy", TRUST_PROXY);

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // Publisher registration API (JSON). Mounted BEFORE the raw body parser so it
  // gets its own JSON parsing and never reaches the payment path. The reserved
  // `/_api` prefix cannot collide with a payment slug (slugs can't start with _).
  app.use("/_api", createRegistrationRouter());

  // Buffer the raw body so we can faithfully forward POST/PUT to the upstream.
  // The gateway middleware reads payment from headers, not the body.
  app.use(express.raw({ type: () => true, limit: "5mb" }));

  const chain = [resolveEndpoint, ipFloodGuard, requirePayment, forward];
  app.all("/:slug", ...chain);
  app.all("/:slug/*", ...chain);

  // Centralized error handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "internal_error";
    console.error("[proxy] unhandled error:", message);
    if (!res.headersSent) res.status(500).json({ error: "internal_error" });
  });

  return app;
}

/** Step 1 — resolve slug to a live (active + verified) endpoint, else 404. */
function resolveEndpoint(req: ProxyRequest, res: Response, next: NextFunction) {
  const slug = req.params.slug;
  const config = slug ? endpointCache.get(slug) : undefined;
  if (!config) {
    res.status(404).json({ error: "endpoint_not_found" });
    return;
  }
  req.endpoint = config;
  next();
}

// Per-IP raw-request flood guard. High ceiling — its only job is to bound abuse
// of the unauthenticated request path; the *economic* per-endpoint and per-agent
// limits live in the settle path (gateway.ts) so an unpaid 402 flood cannot
// exhaust a publisher's paid allowance.
/** Step 2 — per-IP flood guard. */
function ipFloodGuard(req: ProxyRequest, res: Response, next: NextFunction) {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const ipFloodRpm = Number(process.env.IP_FLOOD_RPM ?? 600);
  const { allowed, retryAfterSec } = rateLimiter.hit(`ip:${ip}`, ipFloodRpm);
  if (!allowed) {
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({ error: "ip_rate_limited", retry_after_sec: retryAfterSec });
    return;
  }
  next();
}

/**
 * Step 3 — x402 paywall. Issues 402 when unpaid. When paid, the gateway
 * middleware verifies, then (in onBeforeSettle) fetches the upstream, writes the
 * payment row, and settles — all atomically. We run it inside the request
 * context so the settle hook can reach this request, and we translate a
 * settlement abort into the right HTTP status.
 */
async function requirePayment(req: ProxyRequest, res: Response, next: NextFunction) {
  const handler = getPaymentHandler(req.endpoint!);
  type Mw = (r: ProxyRequest, s: Response, n: NextFunction) => void | Promise<void>;
  const wrappedRes = wrapSettleAbortResponse(req, res);
  try {
    await runWithRequestContext({ req }, () =>
      Promise.resolve((handler as unknown as Mw)(req, wrappedRes as Response, next))
    );
  } catch (err) {
    if (res.headersSent) return;
    respondForSettleAbort(req, res, err);
  }
}

/** Step 4 — relay the upstream response captured during settlement. */
function forward(req: ProxyRequest, res: Response) {
  const up = req.stentUpstream;
  if (!up) {
    res.status(500).json({ error: "missing_upstream_result" });
    return;
  }
  res.status(up.status);
  res.setHeader("Content-Type", up.contentType);
  res.send(up.body);
}

/**
 * Map a settlement abort (SDK throws `Error("Settlement aborted: <reason>")`)
 * to a client response. For an upstream non-2xx we relay the real upstream
 * status/body the agent was trying to reach — unpaid.
 */
function abortResponseForReason(req: ProxyRequest, reason: string): {
  status: number;
  headers?: Record<string, string>;
  body?: Buffer | object;
  contentType?: string;
} {
  if (reason.startsWith("upstream_status_") && req.stentUpstream) {
    return {
      status: req.stentUpstream.status,
      headers: { "Content-Type": req.stentUpstream.contentType },
      body: req.stentUpstream.body,
    };
  }

  const statusByReason: Record<string, number> = {
    upstream_unavailable: 503,
    blocked_target: 502,
    unresolvable: 502,
    invalid_target_url: 502,
    payment_log_failed: 500,
    internal_error: 500,
    replay: 409,
    agent_rate_limited: 429,
    endpoint_rate_limited: 429,
    missing_nonce: 400,
    no_request_context: 500,
  };
  const status = statusByReason[reason] ?? 500;
  const headers =
    reason === "agent_rate_limited" || reason === "endpoint_rate_limited"
      ? { "Retry-After": "60" }
      : undefined;
  return { status, headers, body: { error: reason } };
}

function sendAbortResponse(req: ProxyRequest, res: Response, reason: string) {
  const response = abortResponseForReason(req, reason);
  if (response.headers) {
    for (const [key, value] of Object.entries(response.headers)) res.setHeader(key, value);
  }
  res.status(response.status);
  if (Buffer.isBuffer(response.body)) {
    res.send(response.body);
    return;
  }
  res.json(response.body ?? { error: reason });
}

function respondForSettleAbort(req: ProxyRequest, res: Response, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const reason = /Settlement aborted:\s*(.+)$/i.exec(msg)?.[1]?.trim() ?? "settlement_error";
  sendAbortResponse(req, res, reason);
}

type WritableChunk = string | Buffer | Uint8Array;

function wrapSettleAbortResponse(req: ProxyRequest, res: Response): Response {
  const originalEnd = res.end.bind(res);
  const originalSetHeader = res.setHeader.bind(res);
  const originalStatusCode = res.statusCode;

  res.end = ((chunk?: WritableChunk, encodingOrCb?: BufferEncoding | (() => void), cb?: () => void) => {
    const body = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : "";
    const reason = parseSdkSettleAbortReason(res.statusCode, body);
    if (reason) {
      const response = abortResponseForReason(req, reason);
      res.statusCode = response.status;
      if (response.headers) {
        for (const [key, value] of Object.entries(response.headers)) originalSetHeader(key, value);
      }
      if (Buffer.isBuffer(response.body)) {
        originalSetHeader("Content-Length", String(response.body.length));
        return originalEnd(response.body, cb ?? (typeof encodingOrCb === "function" ? encodingOrCb : undefined));
      }
      originalSetHeader("Content-Type", "application/json");
      const nextBody = JSON.stringify(response.body ?? { error: reason });
      originalSetHeader("Content-Length", String(Buffer.byteLength(nextBody)));
      return originalEnd(
        nextBody,
        cb ?? (typeof encodingOrCb === "function" ? encodingOrCb : undefined)
      );
    }
    res.statusCode = res.statusCode || originalStatusCode;
    return originalEnd(
      chunk as never,
      encodingOrCb as never,
      cb as never
    );
  }) as Response["end"];

  return res;
}

function parseSdkSettleAbortReason(statusCode: number, body: string): string | null {
  if (statusCode !== 402 || !body) return null;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; reason?: unknown };
    if (
      parsed.error === "Payment settlement aborted" &&
      typeof parsed.reason === "string" &&
      parsed.reason.length > 0
    ) {
      return parsed.reason;
    }
  } catch {
    return null;
  }
  return null;
}
