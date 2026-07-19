import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, signOutAdmin } from "@/lib/content/auth";
import { isSameOriginRequest } from "@/lib/http/origin";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return new Response("Cross-origin form submission rejected", { status: 403 });
  }
  // Revoke the Supabase session server-side (best-effort) — clearing the
  // cookie alone leaves the stateless JWT replayable until natural expiry.
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (token) await signOutAdmin(token);
  // Build the redirect as a plain Response: Response.redirect() returns
  // immutable headers, so setting the clear-cookie there throws and the session
  // would survive an explicit sign-out.
  return new Response(null, {
    status: 303,
    headers: {
      location: new URL("/", req.url).toString(),
      "set-cookie": `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}Max-Age=0`,
    },
  });
}
