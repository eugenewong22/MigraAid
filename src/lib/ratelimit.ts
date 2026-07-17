/** Fleet-wide fixed-window rate limiting with a local development fallback. */
import { createHmac, randomBytes } from "node:crypto";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_MEMORY_BUCKETS = 10_000;
const LOCAL_HASH_SALT = randomBytes(32).toString("hex");
let lastSweepAt = 0;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
  source: "redis" | "memory";
}

export interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
}

/** Opaque per-process bucket key for the availability fallback. */
export function localRateLimitKey(
  key: string,
  salt = LOCAL_HASH_SALT,
): string {
  return createHmac("sha256", salt).update(key).digest("hex");
}

function memoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  // Keep raw IPs and other caller identifiers out of process memory too.
  key = localRateLimitKey(key);
  const now = Date.now();
  if (now - lastSweepAt >= 60_000 || buckets.size >= MAX_MEMORY_BUCKETS) {
    for (const [bucketKey, candidate] of buckets) {
      if (candidate.resetAt <= now) buckets.delete(bucketKey);
    }
    // Bound memory even during a flood of never-before-seen keys. Map preserves
    // insertion order, so discard the oldest fallback buckets first.
    while (buckets.size >= MAX_MEMORY_BUCKETS) {
      const oldest = buckets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
    lastSweepAt = now;
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt, source: "memory" };
  }
  if (bucket.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: bucket.resetAt,
      source: "memory",
    };
  }
  bucket.count += 1;
  return {
    ok: true,
    remaining: limit - bucket.count,
    resetAt: bucket.resetAt,
    source: "memory",
  };
}

function externalKey(key: string, token: string): string {
  const secret = process.env.RATE_LIMIT_HASH_SALT ?? token;
  const digest = createHmac("sha256", secret).update(key).digest("hex");
  return `migraaid:rl:${digest}`;
}

/**
 * Produce a stable, opaque key for sensitive identifiers such as admin emails.
 * The raw value never reaches Redis or the in-memory bucket map. In distributed
 * deployments the Redis token is a stable fallback secret; local development
 * uses an ephemeral process salt when no explicit hash salt is configured.
 */
export function sensitiveRateLimitKey(scope: string, value: string): string {
  const normalized = value.trim().normalize("NFKC").toLowerCase();
  const secret =
    process.env.RATE_LIMIT_HASH_SALT ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    LOCAL_HASH_SALT;
  const digest = createHmac("sha256", secret).update(normalized).digest("hex");
  return `${scope}:${digest}`;
}

/**
 * Uses an atomic Redis transaction when Upstash is configured. PEXPIRE NX sets
 * the window only on the first increment. Provider failures fall back locally,
 * keeping worker access available while still applying a per-instance bound.
 */
export async function rateLimit(
  key: string,
  opts: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const limit = opts.limit ?? 20;
  const windowMs = opts.windowMs ?? 60_000;
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    try {
      const response = await fetch(`${url}/multi-exec`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify([
          ["INCR", externalKey(key, token)],
          ["PEXPIRE", externalKey(key, token), windowMs, "NX"],
          ["PTTL", externalKey(key, token)],
        ]),
        signal: AbortSignal.timeout(1_500),
      });
      if (!response.ok) throw new Error(`rate-limit provider returned ${response.status}`);
      const values = (await response.json()) as Array<{ result?: unknown; error?: string }>;
      const count = Number(values[0]?.result);
      const ttl = Number(values[2]?.result);
      if (!Number.isFinite(count) || !Number.isFinite(ttl) || ttl < 0) {
        throw new Error("invalid rate-limit provider response");
      }
      return {
        ok: count <= limit,
        remaining: Math.max(0, limit - count),
        resetAt: Date.now() + ttl,
        source: "redis",
      };
    } catch {
      // Availability-first fallback. Sentry/network monitoring still surfaces
      // provider incidents, while this instance continues enforcing a quota.
    }
  }

  return memoryRateLimit(key, limit, windowMs);
}

/** Derive a client key only from forwarding headers set by a trusted proxy. */
export function clientKey(
  headers: Headers,
  env: { VERCEL?: string; TRUST_PROXY_HEADERS?: string } = {
    VERCEL: process.env.VERCEL,
    TRUST_PROXY_HEADERS: process.env.TRUST_PROXY_HEADERS,
  },
): string {
  const forwarded =
    env.VERCEL === "1"
      ? headers.get("x-vercel-forwarded-for")
      : env.TRUST_PROXY_HEADERS === "true"
        ? (headers.get("x-real-ip") ?? headers.get("x-forwarded-for"))
        : null;
  return forwarded?.split(",")[0]?.trim() || "anon";
}
