import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  contractReviews,
  rateLimitBuckets,
  conversations,
  feedback,
  referrals,
} from "@/lib/db/schema";
import { deleteWorkerSessionData } from "@/lib/privacy/delete";
import {
  MAX_BATCHES_PER_RUN,
  RETENTION_BATCH_SIZE,
  deleteExpiredWorkerData,
  retentionCutoff,
  retentionDays,
} from "@/lib/privacy/retention";
import { DELETE } from "@/app/api/privacy/route";

describe("retentionCutoff", () => {
  it("uses a bounded day-based retention period", () => {
    const now = new Date("2026-07-14T00:00:00.000Z");
    expect(retentionCutoff(now, 30).toISOString()).toBe("2026-06-14T00:00:00.000Z");
  });

  it("falls back safely for invalid configuration", () => {
    const now = new Date("2026-07-14T00:00:00.000Z");
    expect(retentionCutoff(now, -1).toISOString()).toBe("2026-06-14T00:00:00.000Z");
  });

  it("caps retention configuration at the promised 30 days", () => {
    const now = new Date("2026-07-14T00:00:00.000Z");
    expect(retentionCutoff(now, 365).toISOString()).toBe("2026-06-14T00:00:00.000Z");
  });
});

/**
 * Fake Drizzle surface for the retention sweep: selects return the first
 * `limit` rows of a table's remaining state, deletes splice off one batch. This
 * is enough to prove the sweep's structural guarantees — bounded batch sizes,
 * one transaction per conversation batch, and forward progress under a budget.
 */
function fakeRetentionDb(seed: {
  conversations: number;
  contracts: number;
  buckets?: number;
}) {
  const state = {
    buckets: Array.from({ length: seed.buckets ?? 0 }, (_, i) => ({
      id: `bucket-${i}`,
    })),
    conversations: Array.from({ length: seed.conversations }, (_, i) => ({
      id: `conversation-${i}`,
    })),
    contracts: Array.from({ length: seed.contracts }, (_, i) => ({
      id: `contract-${i}`,
    })),
    feedback: [] as Array<{ id: string }>,
  };
  const deleteSizes: number[] = [];
  let transactions = 0;

  const tableRows = (table: unknown) => {
    if (table === conversations) return state.conversations;
    if (table === contractReviews) return state.contracts;
    if (table === feedback) return state.feedback;
    if (table === rateLimitBuckets) return state.buckets;
    return [] as Array<{ id: string }>; // referrals: no protected conversations
  };

  const select = () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async (limit: number) => tableRows(table).slice(0, limit),
        then: (
          onFulfilled: (rows: Array<{ id: string }>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(tableRows(table).slice()).then(onFulfilled, onRejected),
      }),
    }),
  });

  const remove = (table: unknown) => ({
    where: () => {
      let run: Promise<Array<{ id: string }>> | null = null;
      const exec = () =>
        (run ??= Promise.resolve().then(() => {
          const rows = tableRows(table);
          const removed = rows.splice(0, Math.min(RETENTION_BATCH_SIZE, rows.length));
          deleteSizes.push(removed.length);
          return removed;
        }));
      return {
        returning: () => exec(),
        then: (
          onFulfilled: (rows: Array<{ id: string }>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => exec().then(onFulfilled, onRejected),
      };
    },
  });

  const queries = { select, delete: remove };
  const database = {
    ...queries,
    transaction: async (callback: (tx: typeof queries) => unknown) => {
      transactions += 1;
      return callback(queries);
    },
  };

  return {
    database: database as unknown as NonNullable<
      Parameters<typeof deleteExpiredWorkerData>[1]
    >,
    state,
    deleteSizes,
    transactions: () => transactions,
  };
}

describe("deleteExpiredWorkerData", () => {
  it("sweeps in bounded batches with one transaction per conversation batch", async () => {
    const db = fakeRetentionDb({ conversations: 1200, contracts: 700 });

    const result = await deleteExpiredWorkerData(new Date(), db.database);

    expect(result.conversations).toBe(1200);
    expect(result.contractReviews).toBe(700);
    expect(result.complete).toBe(true);
    // 1200 conversations at a 500-row cap → three separate transactions, so a
    // failure in one batch can no longer roll back the whole night's progress.
    expect(db.transactions()).toBe(3);
    expect(Math.max(...db.deleteSizes)).toBeLessThanOrEqual(RETENTION_BATCH_SIZE);
    expect(db.state.conversations).toHaveLength(0);
    expect(db.state.contracts).toHaveLength(0);
  });

  it("stops at the per-run budget and reports the sweep as incomplete", async () => {
    // One batch goes to the (empty) old-feedback pass; the rest of the budget
    // cannot cover this backlog, so the run must commit what it can and say so.
    const backlog = MAX_BATCHES_PER_RUN * RETENTION_BATCH_SIZE;
    const db = fakeRetentionDb({ conversations: backlog, contracts: 10 });

    const result = await deleteExpiredWorkerData(new Date(), db.database);

    expect(result.complete).toBe(false);
    expect(result.conversations).toBe(
      (MAX_BATCHES_PER_RUN - 1) * RETENTION_BATCH_SIZE,
    );
    // Progress is committed: the next scheduled run resumes from here.
    expect(db.state.conversations).toHaveLength(RETENTION_BATCH_SIZE);
    expect(db.state.contracts).toHaveLength(10);
  });
});

describe("deleteWorkerSessionData", () => {
  it("deletes feedback and referrals before deleting session conversations", async () => {
    const selectedConversationIds = [
      { id: "11111111-1111-4111-8111-111111111111" },
      { id: "22222222-2222-4222-8222-222222222222" },
    ];
    const deleteResults = new Map<unknown, Array<{ id: string }>>([
      [feedback, [{ id: "feedback-1" }]],
      [referrals, [{ id: "referral-1" }]],
      [conversations, selectedConversationIds],
      [contractReviews, [{ id: "contract-1" }]],
    ]);
    const deleteMock = vi.fn((table: unknown) => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => deleteResults.get(table) ?? []),
      })),
    }));
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => selectedConversationIds),
        })),
      })),
      delete: deleteMock,
    };
    const database = {
      transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as NonNullable<
      Parameters<typeof deleteWorkerSessionData>[1]
    >;

    const result = await deleteWorkerSessionData("opaque-session", database);

    expect(deleteMock.mock.calls.map(([table]) => table)).toEqual([
      feedback,
      referrals,
      conversations,
      contractReviews,
    ]);
    expect(result).toEqual({
      conversations: 2,
      feedback: 1,
      referrals: 1,
      contractReviews: 1,
    });
  });
});

describe("DELETE /api/privacy — malformed maid_sid cookie", () => {
  function deleteRequest(cookie?: string): NextRequest {
    const headers: Record<string, string> = { origin: "https://example.test" };
    if (cookie !== undefined) headers.cookie = `maid_sid=${cookie}`;
    return new NextRequest(
      new Request("https://example.test/api/privacy", {
        method: "DELETE",
        headers,
      }),
    );
  }

  it("treats a cookie that isn't a server-minted UUID as no session — a no-op success, not an error", async () => {
    // A malformed/fabricated maid_sid must never be used to query or delete
    // against the database; there is no valid session to delete, so this
    // must succeed as a no-op (matching the missing-cookie case) rather than
    // erroring.
    const response = await DELETE(deleteRequest("not-a-uuid"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    // The response still clears whatever malformed cookie the browser held.
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("maid_sid=;");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("still succeeds as a no-op with no maid_sid cookie at all", async () => {
    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("session cookie lifetime", () => {
  it("matches the retention window it scopes", () => {
    // A cookie that outlives the rows it points at is an identifier with
    // nothing left to identify. It was a year against a 30-day window.
    expect(retentionDays(30)).toBe(30);
    expect(retentionDays(7)).toBe(7);
  });

  it("stays inside the promised maximum whatever is configured", () => {
    expect(retentionDays(365)).toBe(30);
    expect(retentionDays(0)).toBe(30);
    expect(retentionDays(Number.NaN)).toBe(30);
  });
});

describe("rate-limit bucket sweep", () => {
  it("removes stale second-tier rate-limit rows", async () => {
    // These hold no worker data — the key is an HMAC and the row is a count —
    // but they are written on every request while Upstash is unreachable, and
    // nothing else removes them. Left alone they grow without bound.
    const db = fakeRetentionDb({ conversations: 0, contracts: 0, buckets: 40 });
    const result = await deleteExpiredWorkerData(new Date(), db.database);

    expect(result.rateLimitBuckets).toBe(40);
    expect(db.state.buckets).toHaveLength(0);
    expect(result.complete).toBe(true);
  });

  it("reports an incomplete run rather than silently leaving a backlog", async () => {
    const db = fakeRetentionDb({
      conversations: 0,
      contracts: 0,
      buckets: RETENTION_BATCH_SIZE * 60,
    });
    const result = await deleteExpiredWorkerData(new Date(), db.database);
    expect(result.complete).toBe(false);
  });
});
