/**
 * Sliding-window rate limiter held in memory. Used for per-account limits (a login attempt per
 * email address), next to the per-IP limits of the auth library. State is per process, which is
 * enough for one replica (ADR-0002).
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  /** Records an attempt for `key`. Returns false when the key is over its limit. */
  allow(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    // Re-insert so that the map stays ordered by last use; the oldest key is evicted first.
    this.hits.delete(key);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (!oldest.done) this.hits.delete(oldest.value);
    }
    return true;
  }
}
