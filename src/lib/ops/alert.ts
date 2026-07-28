/**
 * Telling a human what the app did to itself.
 *
 * This is not the defence — the app degrades on its own, and by the time an
 * alert is written the protective action has already happened. It is the record
 * a maintainer reads afterwards, which is why it is aggressively deduplicated:
 * one message per event per day. An incident that fires ten thousand times is
 * one fact, and a phone that buzzes ten thousand times is a muted phone.
 *
 * Deliberately dumb: a plain POST to whatever URL is configured (ntfy, a
 * Telegram bot, an email-to-webhook bridge). No vendor SDK, no queue, and
 * failure is swallowed — an alert that cannot be delivered must never turn into
 * a worker-facing error.
 */
import { metricDay } from "@/lib/analytics/metrics";
import { reportError } from "@/lib/observability/sentry";

const TIMEOUT_MS = 2_000;
const DEDUP_TTL_SECONDS = 86_400;

export interface AlertBody {
  title: string;
  detail: string;
}

/** Fallback dedup when Redis is unavailable: at least stop per-process spam. */
const seenThisProcess = new Set<string>();

/** Test seam. */
export function resetAlertDedupForTesting(): void {
  seenThisProcess.clear();
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

/**
 * Claim the right to send this event today.
 *
 * `SET NX EX` is atomic, so exactly one lambda among however many are running
 * wins the claim and the rest stay quiet. If Redis is gone — which is itself
 * one of the things worth alerting about — fall back to a per-process guard so
 * the alert still gets out, just possibly once per instance.
 */
async function claim(event: string, now: number): Promise<boolean> {
  const key = `migraaid:alerted:${metricDay(new Date(now))}:${event}`;
  const config = redisConfig();

  if (!config) {
    if (seenThisProcess.has(key)) return false;
    seenThisProcess.add(key);
    return true;
  }

  try {
    const response = await fetch(`${config.url}/multi-exec`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([["SET", key, "1", "NX", "EX", DEDUP_TTL_SECONDS]]),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`alert dedup returned ${response.status}`);
    const [first] = (await response.json()) as Array<{ result?: unknown }>;
    // Redis returns OK when the key was set, null when it already existed.
    return first?.result === "OK";
  } catch {
    if (seenThisProcess.has(key)) return false;
    seenThisProcess.add(key);
    return true;
  }
}

async function deliver(event: string, body: AlertBody): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event,
        title: `MigraAid: ${body.title}`,
        detail: body.detail,
        at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Sentry is the second channel, and console.error the third — reportError
    // writes that before it checks for a DSN, so a Vercel log drain sees this
    // even with no Sentry project configured.
    void reportError(
      err instanceof Error ? err : new Error(`alert delivery failed: ${event}`),
      "ops.alert",
    );
  }
}

/**
 * Send an alert at most once per event per day.
 *
 * Fire-and-forget by design: callers `void` this so nothing on a worker's
 * request path waits for an alert to be delivered.
 */
export async function alertOnce(
  event: string,
  body: AlertBody,
  now = Date.now(),
): Promise<void> {
  if (!(await claim(event, now))) return;
  console.error(`[ops] ${body.title} — ${body.detail}`);
  await deliver(event, body);
}
