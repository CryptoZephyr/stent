import { describe, it, expect } from "vitest";
import { validateRegistration } from "../registration";

const base = {
  slug: "weather-api",
  target_url: "https://api.example.com/weather",
  price_usdc: "0.002",
  publisher_wallet: "0x38D5f89A6f91139d5BeBCEf01E1aaaaAca90D0f1",
  description: "Weather data",
};

describe("validateRegistration", () => {
  it("accepts a well-formed https registration", () => {
    const r = validateRegistration(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.slug).toBe("weather-api");
      expect(r.value.rate_limit_rpm).toBe(100); // default
      expect(r.value.agent_limit_rpm).toBe(10); // default
    }
  });

  it("rejects a non-https target (TLS-only, Security Rule #5)", () => {
    const r = validateRegistration({ ...base, target_url: "http://api.example.com/x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/https/);
  });

  it("allows http loopback only when explicitly opted in (dev)", () => {
    const target = "http://localhost:8787/arc-stats";
    expect(validateRegistration({ ...base, target_url: target }).ok).toBe(false);
    expect(validateRegistration({ ...base, target_url: target }, { allowInsecure: true }).ok).toBe(true);
  });

  it("rejects a bad slug and reserved slugs", () => {
    expect(validateRegistration({ ...base, slug: "Bad Slug" }).ok).toBe(false);
    expect(validateRegistration({ ...base, slug: "_private" }).ok).toBe(false);
    expect(validateRegistration({ ...base, slug: "healthz" }).ok).toBe(false);
  });

  it("rejects an invalid wallet address", () => {
    const r = validateRegistration({ ...base, publisher_wallet: "0xnope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/wallet/);
  });

  it("rejects non-positive / over-precision / over-max prices", () => {
    expect(validateRegistration({ ...base, price_usdc: "0" }).ok).toBe(false);
    expect(validateRegistration({ ...base, price_usdc: "-1" }).ok).toBe(false);
    expect(validateRegistration({ ...base, price_usdc: "0.0000001" }).ok).toBe(false); // 7 dp
    expect(validateRegistration({ ...base, price_usdc: "1001" }).ok).toBe(false);
    expect(validateRegistration({ ...base, price_usdc: "0.001" }).ok).toBe(true);
  });

  it("clamps rate limits into range", () => {
    const r = validateRegistration({ ...base, rate_limit_rpm: 999999, agent_limit_rpm: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rate_limit_rpm).toBe(100_000);
      expect(r.value.agent_limit_rpm).toBe(1);
    }
  });
});
