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

export const runtime = "nodejs";
const MAX_LOGIN_BODY_BYTES = 16 * 1024;

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
      "Admin sign-in requires a trusted client IP source. Set TRUST_PROXY_HEADERS=true behind a proxy that rewrites x-real-ip/x-forwarded-for.",
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

  // An account-key quota closes the distributed-IP credential-stuffing gap.
  // The helper HMACs the normalized address before either limiter backend sees it.
  const accountLimited = await rateLimit(
    sensitiveRateLimitKey("admin-login-account", email),
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
    loginUrl.searchParams.set(
      "error",
      error instanceof AdminAuthError && error.status === 503
        ? "not_configured"
        : "invalid_credentials",
    );
    return Response.redirect(loginUrl, 303);
  }
}
