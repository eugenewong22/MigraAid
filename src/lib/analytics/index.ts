/** Privacy-safe, server-side product analytics. No message text or worker PII. */
import { randomUUID } from "node:crypto";
import { IMPACT_METRICS, incrementMetric } from "./metrics";

export type AnalyticsEvent =
  | { type: "conversation_started"; locale: string; newWorker: boolean }
  | { type: "message_sent"; locale: string; escalated: boolean; tokens?: number }
  | { type: "contract_explained"; locale: string }
  | { type: "referral_created"; org: string }
  | { type: "feedback_submitted"; rating: number };

export interface AnalyticsContext {
  /** Kept for call-site context; never leaves the server or affects event IDs. */
  sessionId?: string;
}

/**
 * Send a PostHog capture event when both key and host are configured. Failures
 * are swallowed so analytics can never break a worker-facing safety flow.
 */
export async function track(
  event: AnalyticsEvent,
  _context: AnalyticsContext = {},
): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.debug("[analytics]", event.type);
  }

  // The local ledger is the source of truth for headline counts. It contains
  // only daily aggregates, so retention/deletion of worker rows cannot rewrite
  // impact history. Telemetry failure must never break a worker-facing flow.
  try {
    switch (event.type) {
      case "conversation_started":
        await incrementMetric(IMPACT_METRICS.conversations, {
          locale: event.locale,
        });
        if (event.newWorker) {
          await incrementMetric(IMPACT_METRICS.uniqueWorkers, {
            locale: event.locale,
          });
        }
        break;
      case "contract_explained":
        await incrementMetric(IMPACT_METRICS.contractsExplained, {
          locale: event.locale,
        });
        break;
      case "referral_created":
        await incrementMetric(IMPACT_METRICS.referralsShown);
        break;
      case "feedback_submitted":
        await incrementMetric(IMPACT_METRICS.feedbackCount);
        await incrementMetric(IMPACT_METRICS.feedbackRatingSum, {
          amount: event.rating,
        });
        if (event.rating >= 4) {
          await incrementMetric(IMPACT_METRICS.feedbackSatisfied);
        }
        break;
      case "message_sent":
        if (event.tokens) {
          await incrementMetric(IMPACT_METRICS.llmTokens, {
            locale: event.locale,
            amount: event.tokens,
          });
        }
        break;
    }
  } catch {
    // The database may be intentionally absent in local/demo mode.
  }

  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.POSTHOG_HOST?.replace(/\/$/, "");
  if (!apiKey || !host) return;

  const { type, ...safeProperties } = event;
  // A fresh ID per event preserves aggregate counts without creating an
  // external activity trail linked to a worker/session. Unique-worker KPIs are
  // computed from the retention-bound local database instead.
  const distinctId = randomUUID();

  try {
    await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event: type,
        properties: {
          ...safeProperties,
          distinct_id: distinctId,
          $process_person_profile: false,
        },
      }),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // Best-effort observability: never affect the user-facing request.
  }
}
