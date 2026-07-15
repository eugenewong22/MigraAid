import type { NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/content/auth";

export async function POST(req: NextRequest) {
  const requestOrigin = req.headers.get("origin");
  if (requestOrigin && requestOrigin !== new URL(req.url).origin) {
    return new Response("Cross-origin form submission rejected", { status: 403 });
  }
  const response = Response.redirect(new URL("/", req.url), 303);
  response.headers.set(
    "set-cookie",
    `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}Max-Age=0`,
  );
  return response;
}
