/**
 * KPI rollups for the fellowship's measurable targets. Reads aggregate counts
 * from the DB (no per-user PII). Wire a product-analytics provider (PostHog) on
 * top later for funnels; these DB rollups are the source of truth for the headline
 * numbers.
 */
import { avg, count, countDistinct, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  conversations,
  contractReviews,
  referrals,
  feedback,
} from "@/lib/db/schema";

export interface Kpis {
  uniqueUsers: number;
  conversations: number;
  contractsExplained: number;
  referrals: number;
  confirmedReferrals: number;
  avgSatisfaction: number | null;
}

export async function getKpis(): Promise<Kpis> {
  const db = getDb();
  const [conv] = await db
    .select({
      users: countDistinct(conversations.anonSessionId),
      total: count(),
    })
    .from(conversations);
  const [contracts] = await db
    .select({ total: count() })
    .from(contractReviews);
  const [refsTotal] = await db.select({ total: count() }).from(referrals);
  const [refsConfirmed] = await db
    .select({ total: count() })
    .from(referrals)
    .where(eq(referrals.confirmedByNgo, true));
  const [fb] = await db.select({ average: avg(feedback.rating) }).from(feedback);

  return {
    uniqueUsers: conv.users,
    conversations: conv.total,
    contractsExplained: contracts.total,
    referrals: refsTotal.total,
    confirmedReferrals: refsConfirmed.total,
    avgSatisfaction: fb.average != null ? Number(fb.average) : null,
  };
}
