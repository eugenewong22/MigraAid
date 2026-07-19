import type { NextRequest } from "next/server";
import { deleteWorkerSessionData } from "@/lib/privacy/delete";
import { tombstoneSession } from "@/lib/privacy/tombstone";
import { clientKey, rateLimit, UNTRUSTED_CLIENT_KEY } from "@/lib/ratelimit";
import { isSameOriginRequest } from "@/lib/http/origin";

export const runtime = "nodejs";

/** Delete all records linkable to the caller's opaque worker session. */
export async function DELETE(req: NextRequest) {
  // Destructive and cookie-authenticated: require an explicit same-origin
  // proof rather than relying on SameSite/preflight behaviour alone.
  if (!isSameOriginRequest(req)) {
    return Response.json(
      { error: "Cross-origin requests are not allowed" },
      { status: 403 },
    );
  }
  const sid = req.cookies.get("maid_sid")?.value;
  const ip = clientKey(req.headers);
  // Without a trusted client IP (self-hosted, no TRUST_PROXY_HEADERS) the
  // network bucket is one shared "anon" pool: 60 cookieless junk requests per
  // hour would then 429 every real worker's deletion right. A session-bearing
  // request is already limited per-sid, so skip the shared bucket for it; the
  // bucket still caps cookieless probing.
  const skipNetworkBucket = Boolean(sid) && ip === UNTRUSTED_CLIENT_KEY;
  const [limited, networkLimited] = await Promise.all([
    rateLimit(`privacy-delete:${sid ? `session:${sid}` : `ip:${ip}`}`, {
      limit: sid ? 3 : 30,
      windowMs: 60 * 60_000,
    }),
    skipNetworkBucket
      ? Promise.resolve({ ok: true as const, resetAt: 0 })
      : rateLimit(`privacy-delete-network:${ip}`, {
          // Avoid one worker on a shared dormitory/network blocking everyone
          // else, while retaining a broad abuse ceiling for cookie rotation.
          limit: 60,
          windowMs: 60 * 60_000,
        }),
  ]);
  if (!limited.ok || !networkLimited.ok) {
    const resetAt = Math.max(limited.resetAt, networkLimited.resetAt);
    return Response.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "retry-after": String(
            Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  /*
   * A missing cookie means there is no server-side worker session to delete,
   * but the response still expires any stale cookie in the browser.
   */
  if (sid) {
    try {
      await deleteWorkerSessionData(sid);
      // Mark the id so an in-flight chat turn that captured it before this
      // commit cannot re-insert rows the expired cookie could never delete.
      await tombstoneSession(sid);
    } catch {
      return Response.json(
        { error: "Could not delete data. Please try again." },
        { status: 503 },
      );
    }
  }

  const response = Response.json({ ok: true });
  response.headers.set(
    "set-cookie",
    `maid_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
  return response;
}
