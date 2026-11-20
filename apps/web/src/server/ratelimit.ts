/** Fixed-window request counters, in memory (one server process). */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Counts one request for `key`; false when the window's allowance is used up. */
  take(key: string, limit: number, windowMs: number): boolean {
    const t = this.now();
    if (this.hits.size > 50_000) this.sweep(t);
    const h = this.hits.get(key);
    if (!h || t >= h.resetAt) {
      this.hits.set(key, { count: 1, resetAt: t + windowMs });
      return true;
    }
    if (h.count >= limit) return false;
    h.count += 1;
    return true;
  }

  private sweep(t: number): void {
    for (const [k, h] of this.hits) if (t >= h.resetAt) this.hits.delete(k);
  }
}
