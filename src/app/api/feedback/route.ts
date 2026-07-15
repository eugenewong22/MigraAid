import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { conversations, feedback, messages } from "@/lib/db/schema";
import { track } from "@/lib/analytics";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { and, eq } from "drizzle-orm";
import {
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/http/body";
import { reportError } from "@/lib/observability/sentry";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/feedback — { rating: 1-5, conversationId, messageId }.
 * The opaque message id must identify an assistant answer owned by the current
 * anonymous session. Free-text feedback is intentionally not accepted.
 */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(`feedback:${clientKey(req.headers)}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
  let body: { rating?: unknown; conversationId?: unknown; messageId?: unknown };
  try {
    body = (await readBoundedJson(req, 4 * 1024)) as typeof body;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Request body too large" }, { status: 413 });
    }
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return Response.json({ error: "Invalid rating" }, { status: 400 });
  }
  const sid = req.cookies.get("maid_sid")?.value;
  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : "";
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  if (!sid) {
    return Response.json({ error: "Anonymous session is required" }, { status: 401 });
  }
  if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(messageId)) {
    return Response.json(
      { error: "Conversation and answer identifiers are required" },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const [ownedAnswer] = await db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.conversationId, conversationId),
          eq(messages.role, "assistant"),
          eq(conversations.anonSessionId, sid),
        ),
      )
      .limit(1);
    if (!ownedAnswer) {
      return Response.json({ error: "Answer not found" }, { status: 404 });
    }

    await db
      .insert(feedback)
      .values({
        rating,
        conversationId,
        messageId,
      });
    await track({ type: "feedback_submitted", rating }, { sessionId: sid });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return Response.json({ error: "Answer already rated" }, { status: 409 });
    }
    await reportError(error, "api.feedback.persistence");
    return Response.json({ error: "Feedback is unavailable" }, { status: 503 });
  }

  return Response.json({ ok: true });
}
