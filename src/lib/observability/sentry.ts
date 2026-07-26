import type { ErrorEvent, Event, EventHint } from "@sentry/nextjs";
import { scrubPii } from "@/lib/safety/pii";

function stripRequestAndUser(event: Event): void {
  delete event.user;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.headers;
    delete event.request.query_string;
  }
  // Arbitrary extras can carry request content; drop them wholesale.
  delete event.extra;
}

/** Remove request/user details and redact common PII before an ERROR event is sent. */
export function sanitizeSentryEvent(
  event: ErrorEvent,
  _hint?: EventHint,
): ErrorEvent {
  stripRequestAndUser(event);
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = scrubPii(value.value).slice(0, 2_000);
  }
  if (event.message) event.message = scrubPii(event.message).slice(0, 2_000);
  // Breadcrumbs can capture console output / navigation that includes request data.
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubPii(crumb.message).slice(0, 1_000);
    delete crumb.data;
  }
  return event;
}

/**
 * Transaction (performance) events bypass beforeSend in the Sentry SDK, so
 * sampled traces would otherwise export request context (URL/query string, span
 * descriptions/data) to a third party unscrubbed. Strip the same request/user
 * details AND the span/trace payloads — auto-instrumented fetch/DB spans carry
 * outbound URLs and query metadata that stripRequestAndUser alone leaves intact.
 */
export function sanitizeSentryTransaction<T extends Event>(event: T): T {
  stripRequestAndUser(event);
  // Span descriptions/data can hold outbound URLs, params, and query metadata.
  // `description` is where auto-instrumented http/fetch spans put the full
  // outbound URL and DB spans put the SQL statement, so it must go too.
  for (const span of event.spans ?? []) {
    delete (span as { data?: unknown }).data;
    delete (span as { description?: unknown }).description;
  }
  if (event.contexts?.trace) {
    delete (event.contexts.trace as { data?: unknown }).data;
    delete (event.contexts.trace as { description?: unknown }).description;
  }
  return event;
}

/** Report a caught server error without exposing it in the API response. */
export async function reportError(error: unknown, area: string): Promise<void> {
  const original = error instanceof Error ? error : new Error(String(error));
  const safe = new Error(scrubPii(original.message).slice(0, 2_000));
  safe.name = original.name;
  safe.stack = original.stack ? scrubPii(original.stack).slice(0, 12_000) : safe.stack;
  console.error(`[${area}]`, safe.message);

  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(safe, { tags: { area } });
    await Sentry.flush(1_500);
  } catch {
    // Error reporting must never interfere with a user-facing safety path.
  }
}
