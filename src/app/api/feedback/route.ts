import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { feedback } from "@/lib/db/schema";
import { track } from "@/lib/analytics";

export const runtime = "nodejs";

/**
 * POST /api/feedback — { rating: 1-5, conversationId?, comment? }.
 * Feeds the satisfaction KPI. Best-effort: capture failures never surface to the
 * worker (the answer was already delivered).
 */
export async function POST(req: NextRequest) {
  let body: { rating?: unknown; conversationId?: unknown; comment?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return Response.json({ error: "Invalid rating" }, { status: 400 });
  }

  try {
    await getDb()
      .insert(feedback)
      .values({
        rating,
        conversationId:
          typeof body.conversationId === "string" ? body.conversationId : null,
        comment: typeof body.comment === "string" ? body.comment : null,
      });
    track({ type: "feedback_submitted", rating });
  } catch {
    // No DB configured (or transient) — don't fail the user-facing request.
  }

  return Response.json({ ok: true });
}
