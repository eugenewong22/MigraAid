import type { NextRequest } from "next/server";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { retrieve, normalizeQueryForRetrieval } from "@/lib/rag/retrieve";
import { preflightSafetyAnswer, streamAnswer } from "@/lib/rag/answer";
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
import { and, eq, gt } from "drizzle-orm";
import { detectHighStakesIssue } from "@/lib/safety/policy";
import { scrubPii } from "@/lib/safety/pii";
import { reportError } from "@/lib/observability/sentry";
import {
  generateHandoffCode,
  handoffCodeExpiry,
  hashHandoffCode,
} from "@/lib/referral/handoff";
import {
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/http/body";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/chat — retrieve sources, then stream a grounded, cited answer.
 *
 * Response is NDJSON. The complete answer is released atomically only after
 * citation and escalation validation:
 *   {"type":"done","text":"...","citations":[...],"escalated":bool}
 *   {"type":"error","message":"..."}                    (on failure)
 */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(`chat:${clientKey(req.headers)}`, {
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
    body = await readBoundedJson(req, 8 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new Response("Request body too large", { status: 413 });
    }
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
    typeof raw.conversationId === "string" && UUID_PATTERN.test(raw.conversationId)
      ? raw.conversationId
      : undefined;

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
        let result = preflightSafetyAnswer(message, locale);
        let normalizedQuery = message;
        if (!result && locale !== "en") {
          // Reuse the English translation retrieval needs anyway to run the
          // deterministic high-stakes / injection checks on English text — the
          // raw per-language phrase lists miss most non-English phrasings.
          normalizedQuery = await normalizeQueryForRetrieval(
            scrubPii(message),
            locale,
          );
          result = preflightSafetyAnswer(normalizedQuery, locale);
        }
        if (!result) {
          const chunks = await retrieve({
            query: message,
            locale,
            normalizedQuery: locale === "en" ? undefined : normalizedQuery,
          });
          const generated = streamAnswer({ query: message, locale, chunks });
          // Generation stays buffered until its citations/tool calls pass the
          // safety gate. The browser receives one atomic terminal payload.
          for await (const _delta of generated.textStream) {
            // Draining completes the provider stream and resolves final().
          }
          result = await generated.final();
        }
        const deterministicIssue =
          detectHighStakesIssue(message) ?? detectHighStakesIssue(normalizedQuery);
        result.escalated = result.escalated || Boolean(deterministicIssue);
        result.issueType ??= deterministicIssue;
        const referrals =
          result.escalated && result.issueType
            ? referralTargets(result.issueType)
            : [];

        // Persist the anonymised conversation + turn (best-effort — no DB in dev).
        let cid = conversationId;
        let assistantMessageId: string | undefined;
        let referralCode: string | undefined;
        let referralExpiresAt: string | undefined;
        try {
          const db = getDb();
          const persisted = await db.transaction(async (tx) => {
            let activeConversationId = cid;

            // Never let a client attach a turn to another anonymous session by
            // guessing or replaying its conversation UUID.
            if (activeConversationId) {
              const [owned] = await tx
                .select({ id: conversations.id })
                .from(conversations)
                .where(
                  and(
                    eq(conversations.id, activeConversationId),
                    eq(conversations.anonSessionId, sid),
                  ),
                )
                .limit(1);
              if (!owned) activeConversationId = undefined;
            }

            let started: { newWorker: boolean } | undefined;
            if (!activeConversationId) {
              const [created] = await tx
                .insert(conversations)
                .values({ anonSessionId: sid, lang: locale })
                .returning({ id: conversations.id });
              activeConversationId = created.id;
              // First-seen is derived from the durable session cookie (1-year
              // Max-Age), NOT from conversation rows — those are purged on
              // retention / right-to-delete, which would otherwise re-count a
              // returning worker as new and inflate the unique-worker KPI.
              started = { newWorker: !existingSid };
            }

            const insertedMessages = await tx
              .insert(messages)
              .values([
                {
                  conversationId: activeConversationId,
                  role: "user",
                  text: scrubPii(message),
                },
                {
                  conversationId: activeConversationId,
                  role: "assistant",
                  text: scrubPii(result.text),
                  citations: result.citations,
                  model: result.model,
                  tokens: result.usage?.totalTokens,
                  escalated: result.escalated,
                },
              ])
              .returning({ id: messages.id, role: messages.role });
            const assistantId = insertedMessages.find(
              (storedMessage) => storedMessage.role === "assistant",
            )?.id;

            await tx
              .update(conversations)
              .set({ lastActivityAt: new Date(), lang: locale })
              .where(eq(conversations.id, activeConversationId));

            let handoff:
              | { code: string; expiresAt: Date }
              | undefined;
            if (referrals.length > 0) {
              // Mint only one active referral + handoff code per conversation;
              // later escalated turns reuse the code the worker already holds
              // (avoids KPI inflation and multiple confusing codes).
              const [existingActive] = await tx
                .select({ id: referralsTable.id })
                .from(referralsTable)
                .where(
                  and(
                    eq(referralsTable.conversationId, activeConversationId),
                    eq(referralsTable.confirmedByNgo, false),
                    gt(referralsTable.expiresAt, new Date()),
                  ),
                )
                .limit(1);
              if (!existingActive) {
                const code = generateHandoffCode();
                const expiresAt = handoffCodeExpiry();
                await tx.insert(referralsTable).values({
                  conversationId: activeConversationId,
                  issueType: result.issueType ?? "referral",
                  org: referrals.map((referral) => referral.org).join(", "),
                  outcome: "surfaced",
                  handoffCodeHash: hashHandoffCode(code),
                  expiresAt,
                });
                handoff = { code, expiresAt };
              }
            }

            return {
              conversationId: activeConversationId,
              assistantMessageId: assistantId,
              started,
              handoff,
            };
          });

          cid = persisted.conversationId;
          assistantMessageId = persisted.assistantMessageId;
          referralCode = persisted.handoff?.code;
          referralExpiresAt = persisted.handoff?.expiresAt.toISOString();
          if (persisted.started) {
            await track(
              {
                type: "conversation_started",
                locale,
                newWorker: persisted.started.newWorker,
              },
              { sessionId: sid },
            );
          }
          if (persisted.handoff) {
            await track(
              { type: "referral_created", org: referrals[0].org },
              { sessionId: sid },
            );
          }
        } catch (persistenceError) {
          // No database configured — skip persistence, still answer the worker.
          if (process.env.DATABASE_URL) {
            await reportError(persistenceError, "api.chat.persistence");
          }
        }

        controller.enqueue(
          write({
            type: "done",
            text: result.text,
            conversationId: cid ?? null,
            messageId: assistantMessageId ?? null,
            citations: result.citations,
            escalated: result.escalated,
            referrals,
            referralCode: referralCode ?? null,
            referralExpiresAt: referralExpiresAt ?? null,
          }),
        );
        await track(
          {
            type: "message_sent",
            locale,
            escalated: result.escalated,
            tokens: result.usage?.totalTokens,
          },
          { sessionId: sid },
        );
      } catch (err) {
        await reportError(err, "api.chat");
        controller.enqueue(
          write({ type: "error", message: "Unable to answer safely right now." }),
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
      `maid_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}Max-Age=31536000`;
  }
  return new Response(stream, { headers });
}
