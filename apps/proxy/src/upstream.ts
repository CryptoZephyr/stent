import type { Request } from "express";
import type { EndpointConfig } from "./supabaseClient";

// Upstream fetch timeout. Read directly from the environment (not the `env`
// module) so this file stays free of required-secret imports and is unit-testable.
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_HEALTH_TIMEOUT_MS ?? 4000);

/**
 * Build the concrete upstream URL for a request: endpoint base + any wildcard
 * path remainder + original query string. Shared by the settle-time fetch so the
 * payment is gated on (and the agent receives) the exact resource it asked for.
 */
export function resolveTargetUrl(config: EndpointConfig, req: Request): string {
  const base = config.target_url.replace(/\/$/, "");
  const remainder = (req.params as Record<string, string>)[0];
  const qIndex = req.originalUrl.indexOf("?");
  const qs = qIndex >= 0 ? req.originalUrl.slice(qIndex) : "";
  return `${base}${remainder ? `/${remainder}` : ""}${qs}`;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

// Stent-internal / payment headers that must not leak to the unmodified upstream.
const STRIP = new Set(["x-payment", "payment-signature", "x-payment-response"]);

export interface ForwardResult {
  status: number;
  contentType: string;
  body: Buffer;
}

/**
 * Filter inbound request headers for forwarding: drop hop-by-hop headers and
 * Stent/x402 payment headers so nothing payment-related leaks to the unmodified
 * upstream. Exported for unit testing.
 */
export function filterUpstreamHeaders(
  reqHeaders: Record<string, string | string[] | undefined>
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(reqHeaders)) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key) || STRIP.has(key) || v === undefined) continue;
    headers[key] = Array.isArray(v) ? v.join(", ") : v;
  }
  return headers;
}

/** Forward a request to the resolved upstream URL and capture the response. */
export async function forwardToUpstream(
  targetUrl: string,
  method: string,
  reqHeaders: Record<string, string | string[] | undefined>,
  body: Buffer | undefined
): Promise<ForwardResult> {
  const headers = filterUpstreamHeaders(reqHeaders);

  const init: RequestInit = { method, headers };
  if (body && body.length > 0 && method !== "GET" && method !== "HEAD") {
    init.body = body;
  }

  // Bound the upstream fetch so a hung origin can't stall a settle indefinitely.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(targetUrl, { ...init, signal: controller.signal });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      body: buf,
    };
  } finally {
    clearTimeout(timer);
  }
}
