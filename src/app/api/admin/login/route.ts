import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, AdminAuthError, signInAdmin } from "@/lib/content/auth";
import {
  clientKey,
  rateLimit,
  sensitiveRateLimitKey,
  UNTRUSTED_CLIENT_KEY,
} from "@/lib/ratelimit";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import {
  readBoundedUrlEncoded,
  RequestBodyTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/http/body";
import { isSameOriginRequest } from "@/lib/http/origin";
import { reportError } from "@/lib/observability/sentry";

export const runtime = "nodejs";
const MAX_LOGIN_BODY_BYTES = 16 * 1024;

// Detection-only: a GLOBAL (cross-IP) failure counter for a single account,
// keyed on the HMAC'd email alone. This deliberately does NOT block sign-in —
// gating on email alone was removed from the blocking per-(email,IP) cap
// below precisely because it let an attacker on other IPs fill a known
// volunteer's shared bucket and lock them out of their own console (see the
// comment on `accountLimited`). That fix also means the per-(email,IP) cap
// has no visibility into failures spread across many IPs against the same
// account — i.e. distributed credential stuffing. This counter exists only
// to surface that pattern as a Sentry alert for a human to investigate.
const ACCOUNT_FAILURE_ALERT_THRESHOLD = 50;
const ACCOUNT_FAILURE_ALERT_WINDOW_MS = 15 * 60_000;
// Dedup so a sustained attack fires one alert per window, not one per
// attempt: `rateLimit`'s in-memory fallback freezes its count once blocked,
// so every attempt after the threshold would otherwise re-report the same
// spike. Bounded like the rate limiter's own bucket map.
const alertedAccountFailureWindows = new Map<string, number>();

/**
 * Fire a (non-blocking, best-effort) Sentry alert once a single account has
 * crossed a high global failure threshold within a window. Never throws —
 * `rateLimit` and `reportError` are both already failure-tolerant — and is
 * called fire-and-forget so it can never add latency to the login response.
 */
async function monitorAccountFailureSpike(email: string): Promise<void> {
  const key = sensitiveRateLimitKey("admin-login-account-global", email);
  const result = await rateLimit(key, {
    limit: ACCOUNT_FAILURE_ALERT_THRESHOLD,
    windowMs: ACCOUNT_FAILURE_ALERT_WINDOW_MS,
  });
  if (result.ok) return;
  if (alertedAccountFailureWindows.get(key) === result.resetAt) return;
  if (alertedAccountFailureWindows.size > 1_000) {
    alertedAccountFailureWindows.clear();
  }
  alertedAccountFailureWindows.set(key, result.resetAt);
  await reportError(
    new Error(
      `Admin login: ${ACCOUNT_FAILURE_ALERT_THRESHOLD}+ failed sign-in attempts against a single account within ${ACCOUNT_FAILURE_ALERT_WINDOW_MS / 60_000} minutes — possible distributed credential stuffing`,
    ),
    "api.admin-login.account-failure-spike",
  );
}

function rateLimited(resetAt: number) {
  return new Response("Too many sign-in attempts", {
    status: 429,
    headers: {
      "retry-after": String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
    },
  });
}

function requireDistributedLimiter(source: "redis" | "memory") {
  if (process.env.NODE_ENV !== "production" || source === "redis") return null;
  return new Response("Admin sign-in is temporarily unavailable", {
    status: 503,
    headers: { "retry-after": "60" },
  });
}

export async function POST(req: NextRequest) {
  // CSRF: require a same-origin Origin (or Referer fallback) on this
  // state-changing POST — a missing Origin header must NOT bypass the check.
  if (!isSameOriginRequest(req)) {
    return new Response("Cross-origin form submission rejected", { status: 403 });
  }
  const ip = clientKey(req.headers);
  if (process.env.NODE_ENV === "production" && ip === UNTRUSTED_CLIENT_KEY) {
    // Without a trusted client IP the 5/15-min bucket below is ONE shared pool:
    // an attacker sending 5 junk POSTs per window locks every volunteer out of
    // admin sign-in indefinitely. Refuse to run with a degraded identity —
    // matching how a degraded distributed limiter 503s — so a self-hosted
    // deploy surfaces the TRUST_PROXY_HEADERS misconfiguration loudly instead
    // of as a mystery lockout. (On Vercel the platform always sets the header.)
    return new Response(
      "Admin sign-in requires a trusted client IP source. Set TRUST_PROXY_HEADERS=true behind a proxy that appends the real client to x-forwarded-for (e.g. nginx's proxy_add_x_forwarded_for).",
      { status: 503 },
    );
  }
  const limited = await rateLimit(`admin-login:${ip}`, {
    limit: 5,
    windowMs: 15 * 60_000,
  });
  const unavailable = requireDistributedLimiter(limited.source);
  if (unavailable) return unavailable;
  if (!limited.ok) {
    return rateLimited(limited.resetAt);
  }

  let form: URLSearchParams;
  try {
    form = await readBoundedUrlEncoded(req, MAX_LOGIN_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new Response("Request body too large", { status: 413 });
    }
    if (error instanceof UnsupportedMediaTypeError) {
      return new Response("Content-Type must be application/x-www-form-urlencoded", {
        status: 415,
      });
    }
    return new Response("Invalid form submission", { status: 400 });
  }
  const rawLocale = form.get("locale");
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  const loginUrl = new URL(`/${locale}/admin/login`, req.url);

  const email = (form.get("email") ?? "").trim();
  const password = form.get("password") ?? "";
  if (!email || email.length > 254 || !password || password.length > 256) {
    loginUrl.searchParams.set("error", "invalid_credentials");
    return Response.redirect(loginUrl, 303);
  }

  // Per-(account, IP) quota. Keying on the email ALONE let an attacker on other
  // IPs fill a known volunteer's shared bucket and lock them out of their own
  // console (a self-sustaining DoS). Scoping to the caller's (already trusted —
  // the anon sentinel is rejected above) IP means an attacker only ever fills
  // their own bucket; the victim's stays clear. Per-IP volume is still capped by
  // the 5/15-min bucket above, and Supabase backstops distributed stuffing.
  const accountLimited = await rateLimit(
    sensitiveRateLimitKey("admin-login-account", `${email}|${ip}`),
    { limit: 10, windowMs: 15 * 60_000 },
  );
  const accountLimiterUnavailable = requireDistributedLimiter(
    accountLimited.source,
  );
  if (accountLimiterUnavailable) return accountLimiterUnavailable;
  if (!accountLimited.ok) return rateLimited(accountLimited.resetAt);

  try {
    const session = await signInAdmin(email, password);
    // Build the redirect as a plain Response: Response.redirect() returns
    // immutable headers, so appending the session cookie there throws — which
    // would swallow the throw and bounce every valid login back as a failure.
    return new Response(null, {
      status: 303,
      headers: {
        location: new URL(`/${locale}/admin`, req.url).toString(),
        "set-cookie": `${ADMIN_COOKIE}=${session.accessToken}; Path=/; HttpOnly; SameSite=Strict; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}Max-Age=${Math.max(60, session.expiresIn - 30)}`,
      },
    });
  } catch (error) {
    const notConfigured = error instanceof AdminAuthError && error.status === 503;
    loginUrl.searchParams.set(
      "error",
      notConfigured ? "not_configured" : "invalid_credentials",
    );
    if (!notConfigured) {
      // A genuine credential/role failure (not a deployment misconfiguration)
      // — feed the detection-only global monitor. Fire-and-forget: must never
      // delay or otherwise affect the redirect below.
      void monitorAccountFailureSpike(email);
    }
    return Response.redirect(loginUrl, 303);
  }
}
