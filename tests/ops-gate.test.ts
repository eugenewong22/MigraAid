import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GLOBAL_LIMIT_PER_MINUTE,
  STALE_GRACE_MS,
  bucketKey,
  gate,
  resetGateCacheForTesting,
} from "@/lib/ops/gate";

const NOW = Date.parse("2026-07-28T04:00:00Z");

const ENV = {
  UPSTASH_REDIS_REST_URL: "https://redis.example.com",
  UPSTASH_REDIS_REST_TOKEN: "token",
  RATE_LIMIT_HASH_SALT: "s".repeat(32),
};

/** Upstash multi-exec reply: one {result} per command, in order. */
function reply(results: unknown[]): Response {
  return new Response(JSON.stringify(results.map((result) => ({ result }))), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A healthy gate reply. Order matches the pipeline in gate.ts:
 * INCR, PEXPIRE, PTTL, HGETALL flags, GET spend, INCR global, PEXPIRE global.
 */
function healthy(overrides: {
  count?: number;
  ttl?: number;
  flags?: string[];
  spend?: string | null;
  global?: number;
} = {}): Response {
  return reply([
    overrides.count ?? 1,
    1,
    overrides.ttl ?? 60_000,
    overrides.flags ?? [],
    overrides.spend ?? null,
    overrides.global ?? 1,
    1,
  ]);
}

beforeEach(() => {
  resetGateCacheForTesting();
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const key of Object.keys(ENV)) delete process.env[key];
});

describe("bucketKey", () => {
  it("never puts a raw identifier in the store", () => {
    const key = bucketKey("chat:203.0.113.7");
    expect(key).not.toContain("203.0.113.7");
    expect(key).toMatch(/^migraaid:rl:[0-9a-f]{64}$/);
  });

  it("is stable for the same input", () => {
    expect(bucketKey("chat:a")).toBe(bucketKey("chat:a"));
    expect(bucketKey("chat:a")).not.toBe(bucketKey("chat:b"));
  });
});

describe("gate on a healthy store", () => {
  it("allows a request inside the limit and reports full service", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(healthy());
    const result = await gate({ key: "chat:ip", limit: 20, now: NOW });

    expect(result).toMatchObject({
      allowed: true,
      source: "redis",
      globalLimited: false,
      spendMicros: 0,
    });
    expect(result.flags.mode).toBe("full");
    expect(result.remaining).toBe(19);
  });

  it("fetches limiter, flags and spend in a single round trip", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(healthy());
    await gate({ key: "chat:ip", now: NOW });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    const commands = body.map((c: unknown[]) => c[0]);
    expect(commands).toEqual([
      "INCR", "PEXPIRE", "PTTL", "HGETALL", "GET", "INCR", "PEXPIRE",
    ]);
  });

  it("refuses once the caller exceeds their limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(healthy({ count: 21 }));
    const result = await gate({ key: "chat:ip", limit: 20, now: NOW });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("refuses on the fleet-wide ceiling even when the caller is under theirs", async () => {
    // A per-IP limit is no limit at all against a botnet with many addresses.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      healthy({ count: 1, global: GLOBAL_LIMIT_PER_MINUTE + 1 }),
    );
    const result = await gate({ key: "chat:ip", limit: 20, now: NOW });
    expect(result.allowed).toBe(false);
    expect(result.globalLimited).toBe(true);
  });

  it("skips the global bucket when a route opts out", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(healthy());
    await gate({ key: "feedback:ip", countsTowardGlobal: false, now: NOW });
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body).toHaveLength(5);
  });

  it("reads flags and today's spend from the same reply", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      healthy({ flags: ["mode", "degraded", "contract", "off"], spend: "1250000" }),
    );
    const result = await gate({ key: "chat:ip", now: NOW });
    expect(result.flags.mode).toBe("degraded");
    expect(result.flags.disabled.has("contract")).toBe(true);
    expect(result.spendMicros).toBe(1_250_000);
  });
});

describe("gate when the store is failing", () => {
  /** Redis down, Postgres down: the bottom of the ladder. */
  function everythingDown() {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    delete process.env.DATABASE_URL;
  }

  it("degrades in production rather than serving unmetered", async () => {
    // No store means no rate limiting AND no spend accounting at the same
    // moment — exactly the conditions for an unbounded bill.
    everythingDown();
    const result = await gate({ key: "chat:ip", now: NOW });

    expect(result.source).toBe("unavailable");
    expect(result.allowed).toBe(false);
    expect(result.flags.mode).toBe("degraded");
  });

  it("stays open in development, so local work needs no Redis", async () => {
    vi.stubEnv("NODE_ENV", "development");
    everythingDown();
    const result = await gate({ key: "chat:ip", now: NOW });

    expect(result.allowed).toBe(true);
    expect(result.flags.mode).toBe("full");
  });

  it("treats a non-2xx reply as a failure, not as data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 }),
    );
    delete process.env.DATABASE_URL;
    expect((await gate({ key: "chat:ip", now: NOW })).source).toBe("unavailable");
  });

  it("rejects a malformed reply rather than trusting a NaN count", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      reply(["not-a-number", 1, 60_000, [], null, 1, 1]),
    );
    delete process.env.DATABASE_URL;
    expect((await gate({ key: "chat:ip", now: NOW })).source).toBe("unavailable");
  });
});

describe("gate stale-value grace window", () => {
  it("serves the last known flags through a brief blip", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      healthy({ flags: ["mode", "full"], spend: "500" }),
    );
    await gate({ key: "chat:ip", now: NOW });

    // …then the store disappears, and Postgres is unavailable too.
    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
    delete process.env.DATABASE_URL;
    const during = await gate({ key: "chat:ip", now: NOW + 5_000 });

    expect(during.source).toBe("cache");
    expect(during.allowed).toBe(true);
    expect(during.flags.mode).toBe("full");
    expect(during.spendMicros).toBe(500);
  });

  it("stops trusting the cache once the grace window has passed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(healthy());
    await gate({ key: "chat:ip", now: NOW });

    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
    delete process.env.DATABASE_URL;
    const after = await gate({ key: "chat:ip", now: NOW + STALE_GRACE_MS + 1 });

    expect(after.source).toBe("unavailable");
    expect(after.flags.mode).toBe("degraded");
  });
});
