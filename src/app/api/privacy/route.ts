import type { NextRequest } from "next/server";
import { deleteWorkerSessionData } from "@/lib/privacy/delete";
import { clientKey, rateLimit } from "@/lib/ratelimit";
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
  const [limited, networkLimited] = await Promise.all([
    rateLimit(`privacy-delete:${sid ? `session:${sid}` : `ip:${ip}`}`, {
      limit: sid ? 3 : 30,
      windowMs: 60 * 60_000,
    }),
    rateLimit(`privacy-delete-network:${ip}`, {
      // Avoid one worker on a shared dormitory/network blocking everyone else,
      // while retaining a broad abuse ceiling for cookie rotation.
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
