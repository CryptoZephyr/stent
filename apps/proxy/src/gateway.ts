import {
  createGatewayMiddleware,
  type GatewayMiddleware,
} from "@circle-fin/x402-batching/server";
import { env } from "./env";
import { supabase, type EndpointConfig } from "./supabaseClient";
import { endpointCache } from "./endpointCache";
import { rateLimiter } from "./rateLimiter";
import { getRequestContext } from "./requestContext";
import { forwardToUpstream, resolveTargetUrl } from "./upstream";
import { evaluateBeforeSettle, type SettleDeps } from "./settleLogic";

type RequireHandler = ReturnType<GatewayMiddleware["require"]>;

interface CachedMiddleware {
  handler: RequireHandler;
  signature: string;
}

/**
 * One `GatewayMiddleware` instance per endpoint slug, because
 * `createGatewayMiddleware` binds a single fixed `sellerAddress` (the publisher
 * wallet) — and the proxy is multi-publisher. Cached and rebuilt only when the
 * endpoint's payment-relevant config changes.
 */
const cache = new Map<string, CachedMiddleware>();

// Rebuild a slug's middleware when its config is invalidated via realtime CDC.
endpointCache.onInvalidate((slug) => cache.delete(slug));

/** Fields whose change requires rebuilding the bound middleware. */
function signatureOf(c: EndpointConfig): string {
  return [c.publisher_wallet, c.price_usdc, c.target_url, c.agent_limit_rpm].join("|");
}

function extractAuthorization(
  payload: { payload: Record<string, unknown> }
): { from?: string; nonce?: string } {
  const auth = (payload.payload as { authorization?: { from?: string; nonce?: string } })
    .authorization;
  return auth ?? {};
}

/** Wire the pure settle logic to the real rate limiter, Supabase, and upstream. */
function realSettleDeps(): SettleDeps {
  return {
    endpointRateLimit: (slug, limit) =>
      rateLimiter.hit(`endpoint:${slug}`, limit).allowed,
    agentRateLimit: (slug, payer, limit) =>
      rateLimiter.hit(`agent:${slug}:${payer}`, limit).allowed,
    replayExists: async (nonce) => {
      try {
        const { data, error } = await supabase
          .from("payments")
          .select("gateway_authorization_id")
          .eq("gateway_authorization_id", nonce)
          .maybeSingle();
        return { exists: !!data, error: !!error };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[payment] replay check failed:", message);
        return { exists: false, error: true };
      }
    },
    fetchUpstream: (config, req) => {
      const target = resolveTargetUrl(config, req);
      const body = Buffer.isBuffer(req.body) ? (req.body as Buffer) : undefined;
      return forwardToUpstream(target, req.method, req.headers, body, {
        allowInsecureLoopback: process.env.STENT_ALLOW_INSECURE_TARGETS === "true",
      });
    },
    insertPayment: async (row) => {
      try {
        const { error } = await supabase.from("payments").insert(row);
        if (!error) return { ok: true, duplicate: false };
        return { ok: false, duplicate: /duplicate key|unique/i.test(error.message) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[payment] insert failed:", message);
        return { ok: false, duplicate: false };
      }
    },
  };
}

const settleDeps = realSettleDeps();

/**
 * Get (or lazily build) the x402 payment middleware for an endpoint.
 *
 * All payment-integrity invariants are enforced in `onBeforeSettle`, which is
 * the *only* hook that can abort settlement (a thrown `onAfterSettle` is
 * swallowed by the SDK). The ordering is strictly:
 *
 *     verify (SDK) → onBeforeSettle{ agent-limit, upstream fetch, DB insert }
 *                  → settle (SDK) → forward relays the already-fetched body
 *
 * Each step can abort with no charge:
 *  - agent over its per-wallet rate limit         → abort `agent_rate_limited`
 *  - upstream unreachable / non-2xx               → abort `upstream_*` (atomicity:
 *    the agent only pays for data we actually fetched and will deliver)
 *  - durable payment log fails                    → abort `payment_log_failed`
 *    (fail-closed: no row ⇒ no settlement) ; duplicate nonce → abort `replay`
 *
 * The upstream body is stashed on the request (`req.stentUpstream`) so the
 * upstream origin is hit exactly once and the same bytes are relayed downstream.
 */
export function getPaymentHandler(config: EndpointConfig): RequireHandler {
  const signature = signatureOf(config);
  const existing = cache.get(config.slug);
  if (existing && existing.signature === signature) return existing.handler;

  const gateway = createGatewayMiddleware({
    sellerAddress: config.publisher_wallet,
    networks: env.network,
    facilitatorUrl: env.facilitatorUrl,
    ...(config.description ? { description: config.description } : {}),
  });

  gateway.onBeforeSettle(async (ctx) => {
    try {
      const auth = extractAuthorization(ctx.paymentPayload);
      const store = getRequestContext();
      const decision = await evaluateBeforeSettle(
        config,
        {
          nonce: auth.nonce,
          payer: auth.from,
          amountAtomic: ctx.requirements.amount,
          req: store?.req,
        },
        env.network,
        settleDeps
      );
      // Stash the fetched upstream body so forward()/error-relay can return it
      // without re-hitting the origin (single upstream hit per request).
      if (store?.req && decision.upstream) store.req.stentUpstream = decision.upstream;
      if (!decision.ok) {
        console.error(`[payment] ${config.slug} aborted: ${decision.reason}`);
        return { abort: true, reason: decision.reason };
      }
      console.log(`[payment] ${config.slug} ${decision.row.agent_address} $${decision.row.amount_usdc} — row written, settling`);
      return; // settlement proceeds
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[payment] ${config.slug} before-settle exception: ${message}`);
      return { abort: true, reason: "internal_error" };
    }
  });

  gateway.onAfterSettle(async (ctx) => {
    const { nonce } = extractAuthorization(ctx.paymentPayload);
    console.log(`[payment] settled ${config.slug} nonce=${nonce} tx=${ctx.result.transaction}`);
  });

  // If settlement throws *after* we wrote the row, roll the row back so the
  // ledger never counts an unsettled payment (reconcilable orphan guard).
  gateway.onSettleFailure(async (ctx) => {
    const { nonce } = extractAuthorization(ctx.paymentPayload);
    if (!nonce) return;
    await supabase.from("payments").delete().eq("gateway_authorization_id", nonce);
    console.warn(`[payment] settle failed for ${config.slug}; rolled back row nonce=${nonce}`);
  });

  const handler = gateway.require(`$${config.price_usdc}`);
  cache.set(config.slug, { handler, signature });
  return handler;
}
