import { describe, it, expect } from "vitest";
import { rateLimit, clientKey } from "@/lib/ratelimit";

describe("rateLimit", () => {
  it("allows up to the limit then blocks within the window", () => {
    const key = `test-${Math.random()}`;
    const opts = { limit: 3, windowMs: 60_000 };
    expect(rateLimit(key, opts).ok).toBe(true);
    expect(rateLimit(key, opts).ok).toBe(true);
    expect(rateLimit(key, opts).ok).toBe(true);
    const blocked = rateLimit(key, opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("tracks keys independently", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    rateLimit(a, { limit: 1 });
    expect(rateLimit(a, { limit: 1 }).ok).toBe(false);
    expect(rateLimit(b, { limit: 1 }).ok).toBe(true);
  });
});

describe("clientKey", () => {
  it("reads the first x-forwarded-for hop", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(clientKey(h)).toBe("203.0.113.5");
  });

  it("falls back to anon when absent", () => {
    expect(clientKey(new Headers())).toBe("anon");
  });
});
