import { and, eq, gt, inArray, lt, notInArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  contractReviews,
  conversations,
  feedback,
  referrals,
} from "@/lib/db/schema";

export const DEFAULT_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 30;

/**
 * Rows per delete statement. Each batch must stay well inside the connection's
 * 15s statement_timeout and Postgres's ~65k bind-parameter cap, so an oversized
 * backlog can never wedge the sweep into a daily all-or-nothing rollback.
 */
export const RETENTION_BATCH_SIZE = 500;

/**
 * Batch budget per invocation — the cron route runs under maxDuration: 60s. An
 * exhausted budget returns complete: false and the next scheduled run resumes
 * from committed progress.
 */
export const MAX_BATCHES_PER_RUN = 40;

/**
 * The retention window actually in force, clamped to the promised maximum.
 *
 * Exported so the session cookie can be given the same lifetime as the data it
 * scopes — a cookie that outlives the rows it points at is a tracking
 * identifier with nothing left to identify.
 */
export function retentionDays(
  days = Number(process.env.DATA_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS),
): number {
  return Number.isFinite(days) && days > 0
    ? Math.max(1, Math.min(MAX_RETENTION_DAYS, Math.floor(days)))
    : DEFAULT_RETENTION_DAYS;
}

export function retentionCutoff(
  now = new Date(),
  days = Number(process.env.DATA_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS),
): Date {
  return new Date(now.getTime() - retentionDays(days) * 24 * 60 * 60 * 1000);
}

/** Runs one deleteBatch at a time until it drains or the run budget is spent. */
async function drainBatches(
  budget: { batches: number },
  deleteBatch: () => Promise<number>,
): Promise<{ deleted: number; drained: boolean }> {
  let deleted = 0;
  while (budget.batches < MAX_BATCHES_PER_RUN) {
    budget.batches += 1;
    const count = await deleteBatch();
    deleted += count;
    if (count < RETENTION_BATCH_SIZE) return { deleted, drained: true };
  }
  return { deleted, drained: false };
}

/**
 * Delete expired worker records, including their linkable free-text dependents.
 * Deletes are batched with per-batch transactions so partial progress commits:
 * a failure mid-sweep leaves earlier batches deleted rather than rolling the
 * whole night's work back.
 */
export async function deleteExpiredWorkerData(
  now = new Date(),
  database: ReturnType<typeof getDb> = getDb(),
) {
  const cutoff = retentionCutoff(now);
  const budget = { batches: 0 };

  // Cleans up any pre-hardening orphan feedback as well as old ratings. The
  // aggregate satisfaction ledger remains intact and contains no worker id.
  const oldFeedback = await drainBatches(budget, async () => {
    const rows = await database
      .select({ id: feedback.id })
      .from(feedback)
      .where(lt(feedback.createdAt, cutoff))
      .limit(RETENTION_BATCH_SIZE);
    if (rows.length === 0) return 0;
    await database.delete(feedback).where(
      inArray(
        feedback.id,
        rows.map(({ id }) => id),
      ),
    );
    return rows.length;
  });

  // A conversation with a still-valid, unconfirmed referral code must survive
  // so a partner NGO can still redeem the code the worker holds — the code TTL
  // can exceed a short (operator-lowered) retention window. The set is bounded
  // by the 30-day code TTL, so it stays far below bind-parameter limits.
  const protectedRows = await database
    .select({ id: referrals.conversationId })
    .from(referrals)
    .where(and(eq(referrals.confirmedByNgo, false), gt(referrals.expiresAt, now)));
  const protectedIds = [...new Set(protectedRows.map(({ id }) => id))];

  const expiredConversations = await drainBatches(budget, () =>
    database.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            lt(conversations.lastActivityAt, cutoff),
            protectedIds.length
              ? notInArray(conversations.id, protectedIds)
              : undefined,
          ),
        )
        .limit(RETENTION_BATCH_SIZE);
      const ids = candidates.map(({ id }) => id);
      if (ids.length === 0) return 0;
      await tx.delete(feedback).where(inArray(feedback.conversationId, ids));
      await tx.delete(referrals).where(inArray(referrals.conversationId, ids));
      const deleted = await tx
        .delete(conversations)
        .where(inArray(conversations.id, ids))
        .returning({ id: conversations.id });
      return deleted.length;
    }),
  );

  const expiredContracts = await drainBatches(budget, async () => {
    const rows = await database
      .select({ id: contractReviews.id })
      .from(contractReviews)
      .where(lt(contractReviews.createdAt, cutoff))
      .limit(RETENTION_BATCH_SIZE);
    if (rows.length === 0) return 0;
    const deleted = await database
      .delete(contractReviews)
      .where(
        inArray(
          contractReviews.id,
          rows.map(({ id }) => id),
        ),
      )
      .returning({ id: contractReviews.id });
    return deleted.length;
  });

  return {
    cutoff,
    conversations: expiredConversations.deleted,
    contractReviews: expiredContracts.deleted,
    complete:
      oldFeedback.drained &&
      expiredConversations.drained &&
      expiredContracts.drained,
  };
}
