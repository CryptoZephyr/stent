import { formatUnits } from "viem";
import type { EndpointConfig } from "./supabaseClient";
import type { ForwardResult } from "./upstream";
import type { ProxyRequest } from "./requestContext";
import { PublicFetchError } from "./verification";

/**
 * Pure, dependency-injected decision logic for `onBeforeSettle`. Extracted from
 * gateway.ts so the payment-integrity invariants (fail-closed logging, upstream
 * atomicity, replay rejection, agent rate limit) can be unit-tested without the
 * Circle SDK, a network, or any required-secret env import.
 *
 * The ordering encodes the guarantees:
 *   missing nonce → no settle
 *   agent over limit → no settle (no upstream hit)
 *   replay (nonce already logged) → no settle (no upstream hit)
 *   upstream unreachable / non-2xx → no settle, no row (atomicity)
 *   DB insert fails → no settle (fail-closed: no row ⇒ no charge)
 *   else → row written, settle proceeds
 */
export interface PaymentRow {
  endpoint_slug: string;
  publisher_wallet: string;
  agent_address: string;
  amount_usdc: string;
  network: string;
  gateway_authorization_id: string;
}

export interface SettleInput {
  nonce?: string;
  /** EIP-3009 authorization.from (payer). */
  payer?: string;
  /** requirements.amount, atomic units (string). */
  amountAtomic: string;
  req?: ProxyRequest;
}

export interface SettleDeps {
  /** Returns true if the endpoint is within its per-endpoint *paid* limit. */
  endpointRateLimit: (slug: string, limit: number) => boolean;
  /** Returns true if the agent is within its per-wallet limit. */
  agentRateLimit: (slug: string, payer: string, limit: number) => boolean;
  /** Has this nonce already been logged? `error` flags a DB read failure. */
  replayExists: (nonce: string) => Promise<{ exists: boolean; error: boolean }>;
  /** Fetch the upstream resource (single hit). Throws on unreachable. */
  fetchUpstream: (config: EndpointConfig, req: ProxyRequest) => Promise<ForwardResult>;
  /** Insert the payment row. `duplicate` distinguishes a unique-violation. */
  insertPayment: (row: PaymentRow) => Promise<{ ok: boolean; duplicate: boolean }>;
}

export type SettleDecision =
  | { ok: true; reason?: undefined; upstream: ForwardResult; row: PaymentRow }
  | { ok: false; reason: string; upstream?: ForwardResult };

export async function evaluateBeforeSettle(
  config: EndpointConfig,
  input: SettleInput,
  network: string,
  deps: SettleDeps
): Promise<SettleDecision> {
  try {
    return await evaluateBeforeSettleUnsafe(config, input, network, deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[payment] before-settle dependency failure:", message);
    return { ok: false, reason: "internal_error" };
  }
}

async function evaluateBeforeSettleUnsafe(
  config: EndpointConfig,
  input: SettleInput,
  network: string,
  deps: SettleDeps
): Promise<SettleDecision> {
  const { nonce, payer, amountAtomic, req } = input;
  if (!nonce) return { ok: false, reason: "missing_nonce" };
  if (!req) return { ok: false, reason: "no_request_context" };

  const payerLc = payer?.toLowerCase();

  // 1) Per-endpoint limit — counts only paid requests (an unpaid 402 flood never
  // reaches settlement), so abusers can't exhaust a publisher's allowance for free.
  if (!deps.endpointRateLimit(config.slug, config.rate_limit_rpm)) {
    return { ok: false, reason: "endpoint_rate_limited" };
  }

  // 2) Per-agent rate limit.
  if (payerLc && !deps.agentRateLimit(config.slug, payerLc, config.agent_limit_rpm)) {
    return { ok: false, reason: "agent_rate_limited" };
  }

  // 3) Replay pre-check (no upstream hit on a reused nonce).
  const replay = await deps.replayExists(nonce);
  if (replay.error) return { ok: false, reason: "payment_log_failed" };
  if (replay.exists) return { ok: false, reason: "replay" };

  // 4) Single upstream fetch; settle only if deliverable (2xx).
  let upstream: ForwardResult;
  try {
    upstream = await deps.fetchUpstream(config, req);
  } catch (err) {
    if (err instanceof PublicFetchError) {
      return {
        ok: false,
        reason: err.reason === "unreachable" ? "upstream_unavailable" : err.reason,
      };
    }
    return { ok: false, reason: "upstream_unavailable" };
  }
  if (upstream.status < 200 || upstream.status >= 300) {
    return { ok: false, reason: `upstream_status_${upstream.status}`, upstream };
  }

  // 5) Durable, fail-closed payment log BEFORE settlement.
  let amountUsdc = amountAtomic;
  try {
    amountUsdc = formatUnits(BigInt(amountAtomic), 6);
  } catch {
    /* already decimal */
  }
  const row: PaymentRow = {
    endpoint_slug: config.slug,
    publisher_wallet: config.publisher_wallet,
    agent_address: payerLc ?? "unknown",
    amount_usdc: amountUsdc,
    network,
    gateway_authorization_id: nonce,
  };
  const ins = await deps.insertPayment(row);
  if (!ins.ok) {
    return { ok: false, reason: ins.duplicate ? "replay" : "payment_log_failed", upstream };
  }
  return { ok: true, upstream, row };
}
