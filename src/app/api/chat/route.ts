import type { NextRequest } from "next/server";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { retrieve } from "@/lib/rag/retrieve";
import { streamAnswer } from "@/lib/rag/answer";
import { referralTargets } from "@/lib/referral/route";
import { rateLimit, clientKey } from "@/lib/ratelimit";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import {
  conversations,
  messages,
  referrals as referralsTable,
} from "@/lib/db/schema";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

/**
 * POST /api/chat — retrieve sources, then stream a grounded, cited answer.
 *
 * Response is NDJSON (one JSON object per line):
 *   {"type":"text","text":"..."}                       (repeated)
 *   {"type":"done","citations":[...],"escalated":bool}  (once at the end)
 *   {"type":"error","message":"..."}                    (on failure)
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`chat:${clientKey(req.headers)}`, {
    limit: 20,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return new Response("Too many requests", {
      status: 429,
      headers: {
        "retry-after": String(
          Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
        ),
      },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const raw = body as {
    message?: unknown;
    locale?: unknown;
    conversationId?: unknown;
  };
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  const locale = hasLocale(routing.locales, raw.locale)
    ? raw.locale
    : routing.defaultLocale;
  const conversationId =
    typeof raw.conversationId === "string" ? raw.conversationId : undefined;

  if (!message) return new Response("Empty message", { status: 400 });
  if (message.length > 2000) {
    return new Response("Message too long", { status: 413 });
  }

  // Anonymous, opaque session id (HttpOnly cookie) — no worker PII.
  const existingSid = req.cookies.get("maid_sid")?.value;
  const sid = existingSid ?? randomUUID();

  const encoder = new TextEncoder();
  const write = (obj: unknown) => encoder.encode(JSON.stringify(obj) + "\n");

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const chunks = await retrieve({ query: message, locale });
        const { textStream, final } = streamAnswer({ query: message, locale, chunks });

        for await (const delta of textStream) {
          controller.enqueue(write({ type: "text", text: delta }));
        }
        const result = await final();
        const referrals =
          result.escalated && result.issueType
            ? referralTargets(result.issueType)
            : [];

        // Persist the anonymised conversation + turn (best-effort — no DB in dev).
        let cid = conversationId;
        try {
          const db = getDb();
          if (!cid) {
            const [c] = await db
              .insert(conversations)
              .values({ anonSessionId: sid, lang: locale })
              .returning({ id: conversations.id });
            cid = c.id;
            track({ type: "conversation_started", locale });
          }
          await db.insert(messages).values([
            { conversationId: cid, role: "user", text: message },
            {
              conversationId: cid,
              role: "assistant",
              text: result.text,
              citations: result.citations,
              model: result.model,
              escalated: result.escalated,
            },
          ]);

          // On escalation, record the referral so an NGO can confirm it later.
          if (referrals.length > 0) {
            await db.insert(referralsTable).values({
              conversationId: cid,
              issueType: result.issueType ?? "referral",
              org: referrals.map((r) => r.org).join(", "),
            });
            track({ type: "referral_created", org: referrals[0].org });
          }
        } catch {
          // No database configured — skip persistence, still answer the worker.
        }

        controller.enqueue(
          write({
            type: "done",
            conversationId: cid ?? null,
            citations: result.citations,
            escalated: result.escalated,
            referrals,
          }),
        );
        track({ type: "message_sent", locale, escalated: result.escalated });
      } catch (err) {
        controller.enqueue(
          write({ type: "error", message: (err as Error).message }),
        );
      } finally {
        controller.close();
      }
    },
  });

  const headers: Record<string, string> = {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
  };
  if (!existingSid) {
    headers["set-cookie"] =
      `maid_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
  }
  return new Response(stream, { headers });
}
