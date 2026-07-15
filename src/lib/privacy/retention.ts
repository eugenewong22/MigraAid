import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  contractReviews,
  conversations,
  feedback,
  referrals,
} from "@/lib/db/schema";

export const DEFAULT_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 90;

export function retentionCutoff(
  now = new Date(),
  days = Number(process.env.DATA_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS),
): Date {
  const safeDays =
    Number.isFinite(days) && days > 0
      ? Math.max(1, Math.min(MAX_RETENTION_DAYS, Math.floor(days)))
      : DEFAULT_RETENTION_DAYS;
  return new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1000);
}

/** Delete expired worker records, including their linkable free-text dependents. */
export async function deleteExpiredWorkerData(
  now = new Date(),
  database: ReturnType<typeof getDb> = getDb(),
) {
  const cutoff = retentionCutoff(now);
  return database.transaction(async (tx) => {
    // Cleans up any pre-hardening orphan feedback as well as old ratings. The
    // aggregate satisfaction ledger remains intact and contains no worker id.
    await tx.delete(feedback).where(lt(feedback.createdAt, cutoff));

    // A conversation with a still-valid, unconfirmed referral code must survive
    // so a partner NGO can still redeem the code the worker holds — the code TTL
    // can exceed a short (operator-lowered) retention window.
    const protectedRows = await tx
      .select({ id: referrals.conversationId })
      .from(referrals)
      .where(and(eq(referrals.confirmedByNgo, false), gt(referrals.expiresAt, now)));
    const protectedIds = new Set(
      protectedRows.map(({ id }) => id).filter((id): id is string => Boolean(id)),
    );

    const conversationRows = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(lt(conversations.lastActivityAt, cutoff));
    const conversationIds = conversationRows
      .map(({ id }) => id)
      .filter((id) => !protectedIds.has(id));

    if (conversationIds.length === 0) {
      const deletedContractsOnly = await tx
        .delete(contractReviews)
        .where(lt(contractReviews.createdAt, cutoff))
        .returning({ id: contractReviews.id });
      return {
        cutoff,
        conversations: 0,
        contractReviews: deletedContractsOnly.length,
      };
    }

    await tx
      .delete(feedback)
      .where(inArray(feedback.conversationId, conversationIds));
    await tx
      .delete(referrals)
      .where(inArray(referrals.conversationId, conversationIds));

    const deletedConversations = await tx
      .delete(conversations)
      .where(inArray(conversations.id, conversationIds))
      .returning({ id: conversations.id });
    const deletedContracts = await tx
      .delete(contractReviews)
      .where(lt(contractReviews.createdAt, cutoff))
      .returning({ id: contractReviews.id });
    return {
      cutoff,
      conversations: deletedConversations.length,
      contractReviews: deletedContracts.length,
    };
  });
}
