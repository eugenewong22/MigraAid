import { describe, expect, it, vi } from "vitest";
import {
  contractReviews,
  conversations,
  feedback,
  referrals,
} from "@/lib/db/schema";
import { deleteWorkerSessionData } from "@/lib/privacy/delete";
import { retentionCutoff } from "@/lib/privacy/retention";

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
