/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * Keyed by an arbitrary string (e.g. `endpoint:<slug>` or `agent:<slug>:<wallet>`).
 * Sufficient for a single-instance proxy. A multi-instance deployment would
 * swap this for a shared store (Redis), but the interface stays identical.
 */
interface Window {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;

class RateLimiter {
  private windows = new Map<string, Window>();

  /**
   * Record a hit and report whether it is allowed under `limitPerMinute`.
   * Returns the remaining allowance and seconds until the window resets.
   */
  hit(key: string, limitPerMinute: number): {
    allowed: boolean;
    remaining: number;
    retryAfterSec: number;
  } {
    const now = Date.now();
    let w = this.windows.get(key);
    if (!w || now >= w.resetAt) {
      w = { count: 0, resetAt: now + WINDOW_MS };
      this.windows.set(key, w);
    }
    w.count += 1;
    const allowed = w.count <= limitPerMinute;
    return {
      allowed,
      remaining: Math.max(0, limitPerMinute - w.count),
      retryAfterSec: Math.ceil((w.resetAt - now) / 1000),
    };
  }

  /** Opportunistically drop expired windows to bound memory. */
  sweep(): void {
    const now = Date.now();
    for (const [k, w] of this.windows) if (now >= w.resetAt) this.windows.delete(k);
  }
}

export const rateLimiter = new RateLimiter();
setInterval(() => rateLimiter.sweep(), WINDOW_MS).unref();
