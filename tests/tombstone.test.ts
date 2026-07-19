import { describe, expect, it, vi, afterEach } from "vitest";
import {
  isSessionTombstoned,
  tombstoneSession,
} from "@/lib/privacy/tombstone";

afterEach(() => {
  vi.useRealTimers();
});

describe("session tombstones (delete/persist race)", () => {
  it("marks a deleted session id and reports it within the window", async () => {
    const sid = "11111111-1111-4111-8111-111111111111";
    expect(await isSessionTombstoned(sid)).toBe(false);
    await tombstoneSession(sid);
    expect(await isSessionTombstoned(sid)).toBe(true);
    // Other sessions are unaffected.
    expect(
      await isSessionTombstoned("22222222-2222-4222-8222-222222222222"),
    ).toBe(false);
  });

  it("expires tombstones after the in-flight-request window", async () => {
    vi.useFakeTimers();
    const sid = "33333333-3333-4333-8333-333333333333";
    await tombstoneSession(sid);
    expect(await isSessionTombstoned(sid)).toBe(true);
    // Past the 120s TTL the id is forgotten — a *new* session that happened
    // to reuse it (impossible for UUIDs, but cheap to bound) is unaffected,
    // and memory cannot accumulate.
    vi.advanceTimersByTime(121_000);
    expect(await isSessionTombstoned(sid)).toBe(false);
  });
});
