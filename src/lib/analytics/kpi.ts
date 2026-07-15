/**
 * KPI rollups for the fellowship's measurable targets. Reads aggregate counts
 * from the DB (no per-user PII). Wire a product-analytics provider (PostHog) on
 * top later for funnels; these DB rollups are the source of truth for the headline
 * numbers. The ledger contains no worker/session identifier and survives raw
 * data retention and right-to-delete operations.
 */
import { getDb } from "@/lib/db";
import { dailyMetrics } from "@/lib/db/schema";
import { IMPACT_METRICS, totalMetric, type MetricRow } from "./metrics";

export interface Kpis {
  uniqueUsers: number;
  conversations: number;
  contractsExplained: number;
  referrals: number;
  confirmedReferrals: number;
  avgSatisfaction: number | null;
  satisfactionRate: number | null;
  totalLlmTokens: number;
}

export function kpisFromMetricRows(rows: MetricRow[]): Kpis {
  const feedbackCount = totalMetric(rows, IMPACT_METRICS.feedbackCount);
  const satisfied = totalMetric(rows, IMPACT_METRICS.feedbackSatisfied);
  const ratingSum = totalMetric(rows, IMPACT_METRICS.feedbackRatingSum);

  return {
    uniqueUsers: totalMetric(rows, IMPACT_METRICS.uniqueWorkers),
    conversations: totalMetric(rows, IMPACT_METRICS.conversations),
    contractsExplained: totalMetric(rows, IMPACT_METRICS.contractsExplained),
    referrals: totalMetric(rows, IMPACT_METRICS.referralsShown),
    confirmedReferrals: totalMetric(rows, IMPACT_METRICS.confirmedReferrals),
    avgSatisfaction: feedbackCount > 0 ? ratingSum / feedbackCount : null,
    satisfactionRate: feedbackCount > 0 ? satisfied / feedbackCount : null,
    totalLlmTokens: totalMetric(rows, IMPACT_METRICS.llmTokens),
  };
}

export async function getKpis(): Promise<Kpis> {
  const db = getDb();
  const rows = await db
    .select({ metric: dailyMetrics.metric, value: dailyMetrics.value })
    .from(dailyMetrics);
  return kpisFromMetricRows(rows);
}
