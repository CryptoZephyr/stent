import { describe, it, expect } from "vitest";
import { resolveTargetUrl, filterUpstreamHeaders, forwardToUpstream } from "../upstream";
import { PublicFetchError, type LookupFn } from "../verification";
import type { EndpointConfig } from "../supabaseClient";
import type { Request } from "express";

const cfg = (target: string): EndpointConfig => ({
  slug: "arc-stats",
  publisher_wallet: "0xSELLER",
  price_usdc: "0.001",
  target_url: target,
  description: null,
  rate_limit_rpm: 100,
  agent_limit_rpm: 10,
  verified: true,
  active: true,
});

const reqLike = (remainder: string | undefined, originalUrl: string) =>
  ({ params: { 0: remainder }, originalUrl } as unknown as Request);

describe("resolveTargetUrl", () => {
  it("maps a bare slug to the endpoint target", () => {
    expect(resolveTargetUrl(cfg("http://localhost:8787/arc-stats"), reqLike(undefined, "/arc-stats")))
      .toBe("http://localhost:8787/arc-stats");
  });

  it("appends a wildcard path remainder", () => {
    expect(resolveTargetUrl(cfg("http://localhost:8787/arc-stats"), reqLike("sub/path", "/arc-stats/sub/path")))
      .toBe("http://localhost:8787/arc-stats/sub/path");
  });

  it("preserves the query string", () => {
    expect(resolveTargetUrl(cfg("http://localhost:8787/arc-stats"), reqLike(undefined, "/arc-stats?a=1&b=2")))
      .toBe("http://localhost:8787/arc-stats?a=1&b=2");
  });

  it("strips a trailing slash on the target base", () => {
    expect(resolveTargetUrl(cfg("https://api.example.com/data/"), reqLike(undefined, "/x")))
      .toBe("https://api.example.com/data");
  });
});

describe("filterUpstreamHeaders", () => {
  it("drops payment + hop-by-hop headers, keeps the rest", () => {
    const out = filterUpstreamHeaders({
      "x-payment": "signed-auth",
      "payment-signature": "sig",
      "x-payment-response": "r",
      host: "proxy.local",
      "content-length": "42",
      connection: "keep-alive",
      accept: "application/json",
      "x-custom": "keep-me",
      "user-agent": "agent/1",
    });
    expect(out).toEqual({
      accept: "application/json",
      "x-custom": "keep-me",
      "user-agent": "agent/1",
    });
  });

  it("joins array-valued headers and skips undefined", () => {
    const out = filterUpstreamHeaders({ "x-multi": ["a", "b"], "x-undef": undefined });
    expect(out).toEqual({ "x-multi": "a, b" });
  });
});

describe("forwardToUpstream SSRF guard", () => {
  const privateLookup: LookupFn = async () => [{ address: "10.0.0.5", family: 4 }];

  it("blocks settle-time fetches to hosts that resolve private", async () => {
    await expect(
      forwardToUpstream("https://attacker.example/data", "GET", {}, undefined, {
        lookupImpl: privateLookup,
      })
    ).rejects.toMatchObject(new PublicFetchError("blocked_target"));
  });

  it("blocks direct metadata IP targets before connecting", async () => {
    await expect(
      forwardToUpstream("https://169.254.169.254/latest/meta-data", "GET", {}, undefined)
    ).rejects.toMatchObject(new PublicFetchError("blocked_target"));
  });
});
