/**
 * One round trip that answers everything a generative route needs to know:
 * may this caller proceed, is the feature switched on, and has today's spend
 * run out.
 *
 * Asking those separately would mean three network calls on the hot path and
 * three independent ways to fail. Upstash's `multi-exec` pipelines them into a
 * single request, so the flags and the spend counter cost nothing beyond the
 * rate-limit check that was already happening.
 *
 * Everything lives in Upstash rather than being split across a second store.
 * The fail-safe policy is already "degrade when the store is unreachable", so a
 * second store would buy nothing except another thing to reason about — and the
 * Postgres tier below already removes Upstash as a single point of failure.
 *
 * Degradation is deliberately gradual:
 *
 *   1. a fresh answer from Upstash;
 *   2. within 60s of the last good answer, the cached one — a blip must not
 *      blackhole the product;
 *   3. a Postgres counter, which is already hard-required and already on the
 *      request path;
 *   4. only then, degraded (in production) or open (in development, so local
 *      work needs no Redis at all).
 */
import { createHmac, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { rateLimitBuckets } from "@/lib/db/schema";
import { metricDay } from "@/lib/analytics/metrics";
import { reportError } from "@/lib/observability/sentry";
import {
  DEFAULT_FLAGS,
  UNREACHABLE_FLAGS,
  parseFlags,
  type OpsFlags,
} from "./flags";
import { inflightKey, spendKey } from "./budget";

const FLAGS_KEY = "migraaid:flags";
const REQUEST_TIMEOUT_MS = 1_500;
/** How long a cached answer may stand in for a fresh one. */
export const STALE_GRACE_MS = 60_000;
/** Global ceiling on concurrent generations, bounding budget overshoot. */
export const MAX_INFLIGHT = 25;
/** Fleet-wide request ceiling; a per-IP limit is no limit against a botnet. */
export const GLOBAL_LIMIT_PER_MINUTE = 600;

const LOCAL_HASH_SALT = randomBytes(32).toString("hex");

export type GateSource = "redis" | "cache" | "postgres" | "unavailable";

export interface GateResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  flags: OpsFlags;
  spendMicros: number;
  /** Where the answer came from — surfaced in readiness and the alert body. */
  source: GateSource;
  /** True when the global ceiling, not the per-caller one, refused. */
  globalLimited: boolean;
}

export interface GateOptions {
  key: string;
  limit?: number;
  windowMs?: number;
  /** Skip the global bucket for cheap non-generative routes. */
  countsTowardGlobal?: boolean;
  now?: number;
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

/** Raw identifiers (IPs, session ids) never reach the store. */
export function bucketKey(key: string): string {
  const secret =
    process.env.RATE_LIMIT_HASH_SALT ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    LOCAL_HASH_SALT;
  return `migraaid:rl:${createHmac("sha256", secret).update(key).digest("hex")}`;
}

interface CachedFlags {
  flags: OpsFlags;
  spendMicros: number;
  at: number;
}

let cache: CachedFlags | null = null;

/** Test seam. */
export function resetGateCacheForTesting(): void {
  cache = null;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Upstash returns HGETALL as a flat [field, value, field, value, …] array. */
function hashFromFlatArray(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < value.length; i += 2) {
    out[String(value[i])] = String(value[i + 1]);
  }
  return out;
}

async function fromRedis(opts: {
  key: string;
  limit: number;
  windowMs: number;
  countsTowardGlobal: boolean;
  now: number;
}): Promise<GateResult | null> {
  const config = redisConfig();
  if (!config) return null;

  const callerKey = bucketKey(opts.key);
  const globalKey = "migraaid:rl:global";
  const commands: unknown[][] = [
    ["INCR", callerKey],
    ["PEXPIRE", callerKey, opts.windowMs, "NX"],
    ["PTTL", callerKey],
    ["HGETALL", FLAGS_KEY],
    ["GET", spendKey(metricDay(new Date(opts.now)))],
  ];
  if (opts.countsTowardGlobal) {
    commands.push(["INCR", globalKey], ["PEXPIRE", globalKey, 60_000, "NX"]);
  }

  try {
    const response = await fetch(`${config.url}/multi-exec`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`ops gate provider returned ${response.status}`);

    const values = (await response.json()) as Array<{ result?: unknown }>;
    const count = toNumber(values[0]?.result, Number.NaN);
    const ttl = toNumber(values[2]?.result, Number.NaN);
    if (!Number.isFinite(count) || !Number.isFinite(ttl) || ttl < 0) {
      throw new Error("invalid ops gate response");
    }

    const flags = parseFlags(hashFromFlatArray(values[3]?.result));
    const spendMicros = toNumber(values[4]?.result);
    const globalCount = opts.countsTowardGlobal
      ? toNumber(values[5]?.result)
      : 0;

    cache = { flags, spendMicros, at: opts.now };

    const globalLimited =
      opts.countsTowardGlobal && globalCount > GLOBAL_LIMIT_PER_MINUTE;
    return {
      allowed: count <= opts.limit && !globalLimited,
      remaining: Math.max(0, opts.limit - count),
      resetAt: opts.now + ttl,
      flags,
      spendMicros,
      source: "redis",
      globalLimited,
    };
  } catch (err) {
    void reportError(
      err instanceof Error ? err : new Error("ops gate request failed"),
      "ops.gate",
    );
    return null;
  }
}

/**
 * Second tier: a fixed-window counter in Postgres.
 *
 * Slower than Redis and not something to run on every request, but Postgres is
 * already required and already on this path, so it means an Upstash outage
 * degrades the *limiter* rather than the whole product. Flags and spend cannot
 * be recovered here — the cached values stand in, or the safe defaults do.
 */
async function fromPostgres(opts: {
  key: string;
  limit: number;
  windowMs: number;
  now: number;
}): Promise<GateResult | null> {
  try {
    const windowStart = new Date(
      Math.floor(opts.now / opts.windowMs) * opts.windowMs,
    );
    const key = bucketKey(opts.key);
    const db = getDb();
    const [row] = await db
      .insert(rateLimitBuckets)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
        set: { count: sql`${rateLimitBuckets.count} + 1` },
      })
      .returning({ count: rateLimitBuckets.count });

    const count = row?.count ?? opts.limit + 1;
    const stale = cache;
    return {
      allowed: count <= opts.limit,
      remaining: Math.max(0, opts.limit - count),
      resetAt: windowStart.getTime() + opts.windowMs,
      flags: stale?.flags ?? DEFAULT_FLAGS,
      spendMicros: stale?.spendMicros ?? 0,
      source: "postgres",
      globalLimited: false,
    };
  } catch (err) {
    void reportError(
      err instanceof Error ? err : new Error("ops gate postgres fallback failed"),
      "ops.gate.postgres",
    );
    return null;
  }
}

/**
 * Ask whether this request may proceed, and under what operating mode.
 *
 * Never throws: a caller on the hot path must always get an answer, and the
 * answer when nothing is reachable is "degrade", not "crash".
 */
export async function gate(opts: GateOptions): Promise<GateResult> {
  const limit = opts.limit ?? 20;
  const windowMs = opts.windowMs ?? 60_000;
  const countsTowardGlobal = opts.countsTowardGlobal ?? true;
  const now = opts.now ?? Date.now();

  const fresh = await fromRedis({ key: opts.key, limit, windowMs, countsTowardGlobal, now });
  if (fresh) return fresh;

  // A blip must not blackhole the product: a recent answer still describes the
  // world well enough to serve from.
  if (cache && now - cache.at < STALE_GRACE_MS) {
    const postgres = await fromPostgres({ key: opts.key, limit, windowMs, now });
    return (
      postgres ?? {
        allowed: true,
        remaining: limit,
        resetAt: now + windowMs,
        flags: cache.flags,
        spendMicros: cache.spendMicros,
        source: "cache",
        globalLimited: false,
      }
    );
  }

  const postgres = await fromPostgres({ key: opts.key, limit, windowMs, now });
  if (postgres) return postgres;

  // Nothing is reachable. In production that means no limiting and no spend
  // accounting simultaneously, so generative routes must stop.
  return {
    allowed: process.env.NODE_ENV !== "production",
    remaining: 0,
    resetAt: now + windowMs,
    flags:
      process.env.NODE_ENV === "production" ? UNREACHABLE_FLAGS : DEFAULT_FLAGS,
    spendMicros: 0,
    source: "unavailable",
    globalLimited: false,
  };
}

/**
 * Move today's spend counter, returning the new total.
 *
 * Called twice per generation: once to reserve the worst case before the model
 * call, once with a negative delta to refund the difference afterwards. Failure
 * is swallowed — a lost increment must not fail a worker's request — but it
 * biases toward over-counting, which is the safe direction.
 */
export async function addSpend(micros: number, now = Date.now()): Promise<void> {
  const config = redisConfig();
  if (!config || micros === 0) return;
  try {
    await fetch(`${config.url}/multi-exec`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["INCRBY", spendKey(metricDay(new Date(now))), Math.round(micros)],
        // Two days, so a reconciliation job can still read yesterday.
        ["EXPIRE", spendKey(metricDay(new Date(now))), 172_800, "NX"],
      ]),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Deliberately silent: the periodic reconciliation against daily_metrics
    // is what detects sustained divergence.
  }
}

/**
 * Claim one of the concurrent-generation slots, or null if the fleet is full.
 *
 * The returned function releases the slot. The key carries a TTL so a lambda
 * killed mid-request cannot leak a slot permanently.
 */
export async function acquireInflight(): Promise<(() => Promise<void>) | null> {
  const config = redisConfig();
  if (!config) return async () => {};

  const headers = {
    authorization: `Bearer ${config.token}`,
    "content-type": "application/json",
  };
  const release = async () => {
    try {
      await fetch(`${config.url}/multi-exec`, {
        method: "POST",
        headers,
        body: JSON.stringify([["DECR", inflightKey()]]),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // The TTL below is the backstop.
    }
  };

  try {
    const response = await fetch(`${config.url}/multi-exec`, {
      method: "POST",
      headers,
      body: JSON.stringify([
        ["INCR", inflightKey()],
        ["EXPIRE", inflightKey(), 90],
      ]),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return async () => {};
    const values = (await response.json()) as Array<{ result?: unknown }>;
    const count = toNumber(values[0]?.result);
    if (count > MAX_INFLIGHT) {
      await release();
      return null;
    }
    return release;
  } catch {
    // Availability over precision here: the spend ceiling is the real bound.
    return async () => {};
  }
}
