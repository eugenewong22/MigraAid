/**
 * Short-lived tombstones for deleted worker sessions.
 *
 * Closes the delete/persist race: a chat turn captures its session id from the
 * cookie at request start and persists up to ~60s later (the route's
 * maxDuration). If "Delete my data" commits inside that window, the turn would
 * re-insert rows under the old session id — and because the deletion response
 * expired the cookie, the worker could never target that id again. Tombstoning
 * the id at delete time lets the chat route skip persistence for it.
 *
 * Storage mirrors the rate limiter's posture: Upstash Redis when configured
 * (covers the multi-instance serverless fleet) with an in-memory fallback.
 * Only an HMAC digest of the session id ever leaves the process. Lookups fail
 * open (treat as not tombstoned) — availability first; the nightly retention
 * sweep remains the durable backstop for any row that slips through.
 */
import { sensitiveRateLimitKey } from "@/lib/ratelimit";

/** Chat route maxDuration is 60s; cover a full in-flight request plus skew. */
const TOMBSTONE_TTL_MS = 120_000;

const memoryTombstones = new Map<string, number>();

function digest(sessionId: string): string {
  return sensitiveRateLimitKey("privacy-tombstone", sessionId);
}

function sweepMemory(now: number) {
  for (const [key, expiresAt] of memoryTombstones) {
    if (expiresAt <= now) memoryTombstones.delete(key);
  }
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

/** Record a just-deleted session id. Best-effort: never throws. */
export async function tombstoneSession(sessionId: string): Promise<void> {
  const key = digest(sessionId);
  const now = Date.now();
  sweepMemory(now);
  memoryTombstones.set(key, now + TOMBSTONE_TTL_MS);

  const redis = redisConfig();
  if (!redis) return;
  try {
    await fetch(
      `${redis.url}/set/${encodeURIComponent(`migraaid:tomb:${key}`)}/1?px=${TOMBSTONE_TTL_MS}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${redis.token}` },
        signal: AbortSignal.timeout(1_500),
      },
    );
  } catch {
    // Memory entry still covers this instance; retention sweep covers the rest.
  }
}

/** Whether this session id was deleted within the tombstone window. */
export async function isSessionTombstoned(sessionId: string): Promise<boolean> {
  const key = digest(sessionId);
  const entry = memoryTombstones.get(key);
  if (entry && entry > Date.now()) return true;

  const redis = redisConfig();
  if (!redis) return false;
  try {
    const response = await fetch(
      `${redis.url}/get/${encodeURIComponent(`migraaid:tomb:${key}`)}`,
      {
        headers: { authorization: `Bearer ${redis.token}` },
        signal: AbortSignal.timeout(1_500),
      },
    );
    if (!response.ok) return false;
    const body = (await response.json()) as { result?: unknown };
    return body.result === "1";
  } catch {
    return false;
  }
}
