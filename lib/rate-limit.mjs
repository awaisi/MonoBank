/**
 * Fixed-window rate limiter keyed by client (usually IP address).
 * In-memory only, which matches MonoBank's single-instance hosting.
 */
export class RateLimiter {
  constructor({ limit, windowMs, now = () => Date.now(), maxKeys = 50_000 }) {
    if (!(limit > 0) || !(windowMs > 0)) throw new Error('RateLimiter needs a positive limit and window.');
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.maxKeys = maxKeys;
    this.windows = new Map();
  }

  /** Count one request for `key`. */
  take(key) {
    const now = this.now();
    let entry = this.windows.get(key);
    if (!entry || now >= entry.resetAt) {
      if (!entry && this.windows.size >= this.maxKeys) this.sweep();
      if (!entry && this.windows.size >= this.maxKeys) this.windows.clear();
      entry = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= this.limit;
    return {
      allowed,
      remaining: Math.max(0, this.limit - entry.count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }

  /** Drop expired windows. */
  sweep() {
    const now = this.now();
    for (const [key, entry] of this.windows) if (now >= entry.resetAt) this.windows.delete(key);
  }
}
