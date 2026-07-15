import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  contractReviews,
  conversations,
  feedback,
  referrals,
} from "@/lib/db/schema";

type Database = ReturnType<typeof getDb>;

export interface WorkerDeletionResult {
  conversations: number;
  feedback: number;
  referrals: number;
  contractReviews: number;
}

/**
 * Delete every local record that can be linked to one opaque worker session.
 *
 * Feedback and referrals are removed explicitly for accurate deletion counts;
 * their cascading foreign keys also close the race if a dependent row appears
 * after the initial ID snapshot. External analytics use unlinkable per-event
 * IDs and therefore contain no session-scoped activity trail to delete.
 */
export async function deleteWorkerSessionData(
  sessionId: string,
  database: Database = getDb(),
): Promise<WorkerDeletionResult> {
  return database.transaction(async (tx) => {
    const conversationRows = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.anonSessionId, sessionId));
    const conversationIds = conversationRows.map(({ id }) => id);

    let deletedFeedback: Array<{ id: string }> = [];
    let deletedReferrals: Array<{ id: string }> = [];

    if (conversationIds.length > 0) {
      deletedFeedback = await tx
        .delete(feedback)
        .where(inArray(feedback.conversationId, conversationIds))
        .returning({ id: feedback.id });
      deletedReferrals = await tx
        .delete(referrals)
        .where(inArray(referrals.conversationId, conversationIds))
        .returning({ id: referrals.id });
    }

    const deletedConversations = await tx
      .delete(conversations)
      .where(eq(conversations.anonSessionId, sessionId))
      .returning({ id: conversations.id });
    const deletedContracts = await tx
      .delete(contractReviews)
      .where(eq(contractReviews.anonSessionId, sessionId))
      .returning({ id: contractReviews.id });

    return {
      conversations: deletedConversations.length,
      feedback: deletedFeedback.length,
      referrals: deletedReferrals.length,
      contractReviews: deletedContracts.length,
    };
  });
}
