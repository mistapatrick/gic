import "server-only";

/**
 * Best-effort in-memory fixed-window rate limiter.
 *
 * Honest limitation: Vercel serverless functions are not guaranteed to
 * share memory across invocations or regions, so this will under-count
 * under real multi-instance load. It still meaningfully slows down a
 * single abusive client hitting a single warm instance, which is the
 * realistic threat model for a free-tier public demo endpoint. For a
 * stronger guarantee, swap this module for Upstash Redis's free tier
 * (`@upstash/ratelimit`) without touching any call site — see SECURITY.md.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Prevent unbounded growth of the in-memory map under sustained traffic from
// many distinct keys (itself a denial-of-service vector if left unchecked).
const MAX_TRACKED_KEYS = 5000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      // Evict the oldest-looking entry rather than grow unbounded.
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt, limit };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt, limit };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
    limit,
  };
}

/** Best-effort client identifier for rate limiting (no auth on this endpoint). */
export function getClientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
