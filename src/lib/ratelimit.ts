/**
 * Fixed-window rate limiter (in-memory).
 *
 * Protects the LLM-backed API routes from abuse — important for a tool serving a
 * targeted, vulnerable population, and to cap runaway cost.
 *
 * NOTE: in-memory state is per-instance, so on a multi-instance/serverless host
 * (Vercel) this bounds each instance, not the fleet. For production, back this
 * with Upstash Redis (swap the Map for a Redis INCR + EXPIRE) behind the same
 * `rateLimit()` signature.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  opts?: { limit?: number; windowMs?: number },
): RateLimitResult {
  const limit = opts?.limit ?? 20;
  const windowMs = opts?.windowMs ?? 60_000;
  const now = Date.now();

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt };
  }

  if (bucket.count >= limit) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { ok: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

/** Derive a best-effort client key from proxy headers. */
export function clientKey(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "anon";
}
