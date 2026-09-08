// Tiny in-memory rate limiter (per key, fixed window). Enough to stop
// token-probing/brute-force on sensitive endpoints; resets with the process.

const buckets = new Map<string, { n: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  // lazy cleanup: drop expired buckets occasionally so the map can't grow forever
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { n: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (b.n >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.n++;
  return { ok: true, retryAfterSec: 0 };
}
