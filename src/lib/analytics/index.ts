/**
 * Privacy-preserving product analytics for the fellowship KPIs (unique users,
 * conversations, contracts explained, referrals, satisfaction). Wired to a
 * provider (PostHog) in M6; this thin capture interface keeps call sites stable.
 */

export type AnalyticsEvent =
  | { type: "conversation_started"; locale: string }
  | { type: "message_sent"; locale: string; escalated: boolean }
  | { type: "contract_explained"; locale: string }
  | { type: "referral_created"; org: string }
  | { type: "feedback_submitted"; rating: number };

/** No-op until a provider is configured (M6). Never sends worker PII. */
export function track(event: AnalyticsEvent): void {
  if (process.env.NODE_ENV !== "production") {
    // Local visibility during development.
    console.debug("[analytics]", event.type, event);
  }
  // TODO(M6): forward to PostHog with a privacy-safe, anonymised payload.
}
