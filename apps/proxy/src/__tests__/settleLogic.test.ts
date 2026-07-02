import { describe, it, expect, vi } from "vitest";
import { evaluateBeforeSettle, type SettleDeps } from "../settleLogic";
import type { EndpointConfig } from "../supabaseClient";
import type { ProxyRequest } from "../requestContext";
import type { ForwardResult } from "../upstream";
import { PublicFetchError } from "../verification";

const NET = "eip155:5042002";

function config(over: Partial<EndpointConfig> = {}): EndpointConfig {
  return {
    slug: "arc-stats",
    publisher_wallet: "0xSELLER",
    price_usdc: "0.001",
    target_url: "http://localhost:8787/arc-stats",
    description: null,
    rate_limit_rpm: 100,
    agent_limit_rpm: 10,
    verified: true,
    active: true,
    ...over,
  };
}

const ok2xx: ForwardResult = { status: 200, contentType: "application/json", body: Buffer.from("{}") };
const req = {} as ProxyRequest;

function deps(over: Partial<SettleDeps> = {}): SettleDeps {
  return {
    endpointRateLimit: vi.fn(() => true),
    agentRateLimit: vi.fn(() => true),
    replayExists: vi.fn(async () => ({ exists: false, error: false })),
    fetchUpstream: vi.fn(async () => ok2xx),
    insertPayment: vi.fn(async () => ({ ok: true, duplicate: false })),
    ...over,
  };
}

const input = { nonce: "0xNONCE", payer: "0xAGENT", amountAtomic: "1000", req };

describe("evaluateBeforeSettle", () => {
  it("happy path: writes row, settles, returns upstream", async () => {
    const d = deps();
    const decision = await evaluateBeforeSettle(config(), input, NET, d);
    expect(decision.ok).toBe(true);
    expect(d.insertPayment).toHaveBeenCalledTimes(1);
    expect(d.insertPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint_slug: "arc-stats",
        agent_address: "0xagent",
        amount_usdc: "0.001", // 1000 atomic → 0.001 USDC
        gateway_authorization_id: "0xNONCE",
        network: NET,
      })
    );
    if (decision.ok) expect(decision.upstream).toBe(ok2xx);
  });

  it("FAIL-CLOSED: a DB insert failure aborts settlement (no row ⇒ no charge)", async () => {
    const d = deps({ insertPayment: vi.fn(async () => ({ ok: false, duplicate: false })) });
    const decision = await evaluateBeforeSettle(config(), input, NET, d);
    expect(decision).toMatchObject({ ok: false, reason: "payment_log_failed" });
  });

  it("FAIL-CLOSED: a thrown replay check aborts instead of propagating to the SDK", async () => {
    const d = deps({ replayExists: vi.fn(async () => { throw new Error("network down"); }) });
    const decision = await evaluateBeforeSettle(config(), input, NET, d);
    expect(decision).toMatchObject({ ok: false, reason: "internal_error" });
    expect(d.fetchUpstream).not.toHaveBeenCalled();
    expect(d.insertPayment).not.toHaveBeenCalled();
  });

  it("FAIL-CLOSED: a thrown DB insert aborts instead of propagating to the SDK", async () => {
    const d = deps({ insertPayment: vi.fn(async () => { throw new Error("TCP reset"); }) });
    const decision = await evaluateBeforeSettle(config(), input, NET, d);
    expect(decision).toMatchObject({ ok: false, reason: "internal_error" });
  });

  it("atomicity: upstream non-2xx aborts, no insert attempted", async () => {
    const upstream404: ForwardResult = { status: 404, contentType: "text/plain", body: Buffer.from("nope") };
    const d = deps({ fetchUpstream: vi.fn(async () => upstream404) });
    const decision = await evaluateBeforeSettle(config(), input, NET, d);
    expect(decision).toMatchObject({ ok: false, reason: "upstream_status_404" });
    if (!decision.ok) expect(decision.upstream).toBe(upstream404); // relayed to agent
    expect(d.insertPayment).not.toHaveBeenCalled();
  });

  it("atomicity: upstream unreachable aborts, no insert attempted", async () => {
    const d = deps({ fetchUpstream: vi.fn(async () => { throw new Error("ECONNREFUSED"); }) });
    const decision = await evaluateBeforeSettle(config(), input, NET, d);
    expect(decision).toMatchObject({ ok: false, reason: "upstream_unavailable" });
    expect(d.insertPayment).not.toHaveBeenCalled();
  });

  it("SSRF: blocked upstream targets abort with a specific blocked_target reason", async () => {
    const d = deps({ fetchUpstream: vi.fn(async () => { throw new PublicFetchError("blocked_target"); }) });
    const decision = await evaluateBeforeSettle(config(), input, NET, d);
    expect(decision).toMatchObject({ ok: false, reason: "blocked_target" });
    expect(d.insertPayment).not.toHaveBeenCalled();
  });

  it("replay: reused nonce aborts BEFORE any upstream hit", async () => {
    const d = deps({ replayExists: vi.fn(async () => ({ exists: true, error: false })) });
    const decision = await evaluateBeforeSettle(config(), input, NET, d);
    expect(decision).toMatchObject({ ok: false, reason: "replay" });
    expect(d.fetchUpstream).not.toHaveBeenCalled();
    expect(d.insertPayment).not.toHaveBeenCalled();
  });

  it("replay: a unique-violation on insert is reported as replay", async () => {
    const d = deps({ insertPayment: vi.fn(async () => ({ ok: false, duplicate: true })) });
    const decision = await evaluateBeforeSettle(config(), input, NET, d);
    expect(decision).toMatchObject({ ok: false, reason: "replay" });
  });

  it("replay read error → payment_log_failed (fail closed), no upstream hit", async () => {
    const d = deps({ replayExists: vi.fn(async () => ({ exists: false, error: true })) });
    const decision = await evaluateBeforeSettle(config(), input, NET, d);
    expect(decision).toMatchObject({ ok: false, reason: "payment_log_failed" });
    expect(d.fetchUpstream).not.toHaveBeenCalled();
  });

  it("agent over its rate limit aborts before replay-check and upstream", async () => {
    const d = deps({ agentRateLimit: vi.fn(() => false) });
    const decision = await evaluateBeforeSettle(config(), input, NET, d);
    expect(decision).toMatchObject({ ok: false, reason: "agent_rate_limited" });
    expect(d.replayExists).not.toHaveBeenCalled();
    expect(d.fetchUpstream).not.toHaveBeenCalled();
  });

  it("endpoint over its (paid) rate limit aborts before any upstream hit", async () => {
    const d = deps({ endpointRateLimit: vi.fn(() => false) });
    const decision = await evaluateBeforeSettle(config(), input, NET, d);
    expect(decision).toMatchObject({ ok: false, reason: "endpoint_rate_limited" });
    expect(d.agentRateLimit).not.toHaveBeenCalled();
    expect(d.fetchUpstream).not.toHaveBeenCalled();
  });

  it("missing nonce / missing request context abort early", async () => {
    expect(await evaluateBeforeSettle(config(), { ...input, nonce: undefined }, NET, deps()))
      .toMatchObject({ ok: false, reason: "missing_nonce" });
    expect(await evaluateBeforeSettle(config(), { ...input, req: undefined }, NET, deps()))
      .toMatchObject({ ok: false, reason: "no_request_context" });
  });
});
