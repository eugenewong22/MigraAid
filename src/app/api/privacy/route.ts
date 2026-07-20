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
  // The network bucket always applies — an unthrottled DB-hitting endpoint is
  // abusable with rotating fabricated cookies (each spawns a fresh per-session
  // bucket). Without a trusted client IP (self-hosted, no TRUST_PROXY_HEADERS)
  // every caller shares one "anon" pool, so a low limit there would 429 real
  // workers' deletion right; raise the ceiling in that case so it bounds abuse
  // without locking legitimate workers out. A trusted per-IP bucket stays tight.
  const networkLimit = ip === UNTRUSTED_CLIENT_KEY ? 600 : 60;
  const [limited, networkLimited] = await Promise.all([
    rateLimit(`privacy-delete:${sid ? `session:${sid}` : `ip:${ip}`}`, {
      limit: sid ? 3 : 30,
      windowMs: 60 * 60_000,
    }),
    rateLimit(`privacy-delete-network:${ip}`, {
      limit: networkLimit,
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
      // Tombstone BEFORE the delete, not after: an in-flight chat/contract turn
      // checks the tombstone before its own persistence commits, so the marker
      // must be visible for the whole delete window. Any rows a concurrent turn
      // inserted before the tombstone landed are still removed by the delete
      // that follows. (A delete failure after tombstoning is harmless — the
      // tombstone self-expires in 120s and only suppresses persistence.)
      await tombstoneSession(sid);
      await deleteWorkerSessionData(sid);
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
