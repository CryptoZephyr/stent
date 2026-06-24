import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rateLimiter } from "../rateLimiter";

describe("rateLimiter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows up to the limit, blocks the next hit in the window", () => {
    const key = `k:${Math.random()}`;
    expect(rateLimiter.hit(key, 10).allowed).toBe(true); // 1
    let last = true;
    for (let i = 2; i <= 10; i++) last = rateLimiter.hit(key, 10).allowed;
    expect(last).toBe(true); // 10th allowed
    expect(rateLimiter.hit(key, 10).allowed).toBe(false); // 11th blocked
  });

  it("reports retryAfterSec within the 60s window", () => {
    const key = `k:${Math.random()}`;
    const r = rateLimiter.hit(key, 1);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("resets after the window elapses", () => {
    const key = `k:${Math.random()}`;
    rateLimiter.hit(key, 1); // 1 allowed
    expect(rateLimiter.hit(key, 1).allowed).toBe(false); // 2nd blocked
    vi.advanceTimersByTime(61_000);
    expect(rateLimiter.hit(key, 1).allowed).toBe(true); // new window
  });
});
