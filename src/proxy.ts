import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

function contentSecurityPolicy(nonce: string): string {
  const connectOrigins = ["'self'", httpsOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN)];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectOrigins.filter(Boolean).join(" ")}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src 'self' blob: data:",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; ");
}

function httpsOrigin(value: string | undefined): string | null {
  try {
    const url = value ? new URL(value) : null;
    return url?.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export default function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = contentSecurityPolicy(nonce);
  // Next reads the request CSP to apply the nonce to framework-generated scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = handleI18nRouting(request);
  // Preserve next-intl's rewrite/redirect while forwarding the nonce-bearing
  // request headers through Next's supported middleware override mechanism.
  const forwarding = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [key, value] of forwarding.headers) {
    if (key.startsWith("x-middleware-request-") || key === "x-middleware-override-headers") {
      response.headers.set(key, value);
    }
  }
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Run on everything except API routes, Next internals, and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
