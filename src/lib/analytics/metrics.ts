import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { dailyMetrics } from "@/lib/db/schema";

export const IMPACT_METRICS = {
  uniqueWorkers: "unique_workers",
  conversations: "conversations",
  contractsExplained: "contracts_explained",
  referralsShown: "referrals_shown",
  confirmedReferrals: "confirmed_referrals",
  feedbackCount: "feedback_count",
  feedbackSatisfied: "feedback_satisfied",
  feedbackRatingSum: "feedback_rating_sum",
  llmTokens: "llm_tokens",
} as const;

export type ImpactMetric =
  (typeof IMPACT_METRICS)[keyof typeof IMPACT_METRICS];

type MetricDatabase = Pick<ReturnType<typeof getDb>, "insert">;

/** UTC date used for a privacy-safe daily aggregate bucket. */
export function metricDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Atomically add to an aggregate counter. No worker/session identifier is
 * accepted by this API, which keeps the ledger unlinkable by construction.
 */
export async function incrementMetric(
  metric: ImpactMetric,
  options: {
    locale?: string;
    amount?: number;
    now?: Date;
    database?: MetricDatabase;
  } = {},
): Promise<void> {
  const amount = options.amount ?? 1;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Metric increments must be non-negative safe integers");
  }
  if (amount === 0) return;

  const database = options.database ?? getDb();
  await database
    .insert(dailyMetrics)
    .values({
      day: metricDay(options.now),
      metric,
      locale: options.locale ?? "all",
      value: amount,
      updatedAt: options.now ?? new Date(),
    })
    .onConflictDoUpdate({
      target: [dailyMetrics.day, dailyMetrics.metric, dailyMetrics.locale],
      set: {
        value: sql`${dailyMetrics.value} + ${amount}`,
        updatedAt: options.now ?? new Date(),
      },
    });
}

export type MetricRow = Pick<
  typeof dailyMetrics.$inferSelect,
  "metric" | "value"
>;

export function totalMetric(rows: MetricRow[], metric: ImpactMetric): number {
  return rows.reduce(
    (total, row) => total + (row.metric === metric ? row.value : 0),
    0,
  );
}
