import { afterEach, describe, it, expect, vi } from "vitest";
import {
  rateLimit,
  clientKey,
  sensitiveRateLimitKey,
  localRateLimitKey,
} from "@/lib/ratelimit";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("rateLimit", () => {
  it("uses opaque keys for the in-memory fallback", () => {
    const key = localRateLimitKey("chat:203.0.113.7", "test-salt");
    expect(key).not.toContain("203.0.113.7");
    expect(key).toHaveLength(64);
    expect(key).toBe(localRateLimitKey("chat:203.0.113.7", "test-salt"));
  });

  it("allows up to the limit then blocks within the window", async () => {
    const key = `test-${Math.random()}`;
    const opts = { limit: 3, windowMs: 60_000 };
    expect((await rateLimit(key, opts)).ok).toBe(true);
    expect((await rateLimit(key, opts)).ok).toBe(true);
    expect((await rateLimit(key, opts)).ok).toBe(true);
    const blocked = await rateLimit(key, opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("tracks keys independently", async () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    await rateLimit(a, { limit: 1 });
    expect((await rateLimit(a, { limit: 1 })).ok).toBe(false);
    expect((await rateLimit(b, { limit: 1 })).ok).toBe(true);
  });

  it("uses an atomic Upstash transaction without exposing the raw client key", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "secret-token");
    vi.stubEnv("RATE_LIMIT_HASH_SALT", "independent-hash-secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([{ result: 1 }, { result: 1 }, { result: 60_000 }]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await rateLimit("chat:203.0.113.7", {
      limit: 20,
      windowMs: 60_000,
    });

    expect(result.source).toBe("redis");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://redis.example.test/multi-exec");
    expect(init.body).not.toContain("203.0.113.7");
    const commands = JSON.parse(String(init.body)) as string[][];
    expect(commands.map((command) => command[0])).toEqual([
      "INCR",
      "PEXPIRE",
      "PTTL",
    ]);
    expect(commands[0][1]).toBe(commands[1][1]);
    expect(commands[1]).toEqual(["PEXPIRE", commands[0][1], 60_000, "NX"]);
  });
});

describe("clientKey", () => {
  it("reads the last (trusted-proxy-written) x-forwarded-for hop", () => {
    // nginx's `proxy_add_x_forwarded_for` APPENDS the real client, so the
    // leftmost element is attacker-supplied and spoofable; the rightmost is the
    // hop written by our own trusted proxy.
    const h = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(clientKey(h, { TRUST_PROXY_HEADERS: "true" })).toBe("10.0.0.1");
  });

  it("prefers x-real-ip over x-forwarded-for when a proxy is trusted", () => {
    const h = new Headers({
      "x-real-ip": "10.0.0.9",
      "x-forwarded-for": "203.0.113.5, 10.0.0.1",
    });
    expect(clientKey(h, { TRUST_PROXY_HEADERS: "true" })).toBe("10.0.0.9");
  });

  it("prefers the Vercel-managed forwarding header", () => {
    const h = new Headers({
      "x-vercel-forwarded-for": "198.51.100.2",
      "x-forwarded-for": "203.0.113.5",
    });
    expect(clientKey(h, { VERCEL: "1" })).toBe("198.51.100.2");
  });

  it("ignores spoofable forwarding headers without an explicitly trusted proxy", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.5" });
    expect(clientKey(h, {})).toBe("anon");
  });

  it("falls back to anon when absent", () => {
    expect(clientKey(new Headers())).toBe("anon");
  });
});

describe("sensitiveRateLimitKey", () => {
  it("normalizes and HMACs account identifiers before storage", () => {
    vi.stubEnv("RATE_LIMIT_HASH_SALT", "test-only-secret");
    const lower = sensitiveRateLimitKey(
      "admin-login-account",
      "reviewer@example.org",
    );
    const mixed = sensitiveRateLimitKey(
      "admin-login-account",
      "  Reviewer@Example.ORG  ",
    );

    expect(mixed).toBe(lower);
    expect(lower).toMatch(/^admin-login-account:[a-f0-9]{64}$/);
    expect(lower).not.toContain("reviewer@example.org");
  });
});
