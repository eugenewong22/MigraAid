import type { NextRequest } from "next/server";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { retrieve, normalizeQueryForRetrieval } from "@/lib/rag/retrieve";
import {
  preflightSafetyAnswer,
  streamAnswer,
  MAX_TOKENS,
} from "@/lib/rag/answer";
import { referralTargets } from "@/lib/referral/route";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import {
  conversations,
  messages,
  referrals as referralsTable,
} from "@/lib/db/schema";
import { randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import {
  detectHighStakesIssue,
  escalationSeverity,
} from "@/lib/safety/policy";
import { isSessionTombstoned } from "@/lib/privacy/tombstone";
import { deleteWorkerSessionData } from "@/lib/privacy/delete";
import { scrubIdentifiers, scrubPii } from "@/lib/safety/pii";
import { guardGenerativeRoute } from "@/lib/ops/guard";
import { acquireInflight, addSpend } from "@/lib/ops/gate";
import {
  estimateCostMicros,
  estimatePromptTokens,
  reservationMicros,
} from "@/lib/ops/budget";
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
import { isSameOriginRequest } from "@/lib/http/origin";

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
  // The JSON body reader accepts text/plain, which makes this endpoint callable
  // as a preflight-free cross-site "simple request" — every state-changing
  // worker route requires an explicit same-origin proof.
  if (!isSameOriginRequest(req)) {
    return new Response("Cross-origin requests are not allowed", { status: 403 });
  }
  // One call decides everything: quota, feature flag, and today's spend. It
  // also raises the alert when the app has degraded itself, so this route does
  // not have to know what "degraded" means.
  const guard = await guardGenerativeRoute(req, "api.chat", {
    feature: "chat",
    limit: 20,
  });
  if (guard.response) return guard.response;

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

  // Anonymous, opaque session id (HttpOnly cookie) — no worker PII. A cookie
  // that doesn't match the shape the server mints (crypto.randomUUID()) is
  // never trusted as-is — it would otherwise be written verbatim into an
  // unbounded text column and let a client pick its own (predictable, index-
  // bloating) session id. Treat it exactly like a missing cookie.
  const rawSid = req.cookies.get("maid_sid")?.value;
  const existingSid =
    rawSid && UUID_PATTERN.test(rawSid) ? rawSid : undefined;
  const sid = existingSid ?? randomUUID();

  const encoder = new TextEncoder();
  const write = (obj: unknown) => encoder.encode(JSON.stringify(obj) + "\n");

  let cancelled = req.signal.aborted;
  const generationAbort = new AbortController();
  const abortGeneration = () => {
    cancelled = true;
    generationAbort.abort();
  };
  req.signal.addEventListener("abort", abortGeneration, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (value: Uint8Array) => {
        if (cancelled) return false;
        try {
          controller.enqueue(value);
          return true;
        } catch {
          abortGeneration();
          return false;
        }
      };
      // The answer is buffered until it clears the safety gate, so nothing
      // reaches the browser for the whole retrieve+generate window (up to tens
      // of seconds). Emit a heartbeat so the client can tell a slow-but-alive
      // stream from a dead socket and keep its inactivity timer from tripping.
      const heartbeat = setInterval(() => {
        enqueue(write({ type: "ping" }));
      }, 10_000);
      // The answer is buffered until it clears the citation gate, so the only
      // honest thing to show meanwhile is *where we are*, not what was written.
      const status = (stage: string, extra: Record<string, unknown> = {}) =>
        enqueue(write({ type: "status", stage, ...extra }));
      try {
        let result = preflightSafetyAnswer(message, locale);
        let normalizedQuery = message;
        status("searching");
        if (!result && locale !== "en") {
          // Reuse the English translation retrieval needs anyway to run the
          // deterministic high-stakes / injection checks on English text — the
          // raw per-language phrase lists miss most non-English phrasings.
          normalizedQuery = await normalizeQueryForRetrieval(
            scrubIdentifiers(message),
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
          status("reading", { sourceCount: chunks.length });

          // Claim a slot before spending anything. The cap bounds how many
          // requests can be mid-flight and therefore unreconciled, which is
          // what bounds how far past the daily ceiling spend can run.
          const release = await acquireInflight();
          if (!release) {
            enqueue(write({ type: "error", reason: "busy" }));
            return;
          }

          // Charge the worst case up front and refund the difference after.
          // A lambda that dies mid-generation then leaves an over-count, which
          // is the safe direction to be wrong in.
          const reserved = reservationMicros({
            inputTokens: estimatePromptTokens(chunks),
            maxOutputTokens: MAX_TOKENS,
          });
          void addSpend(reserved);

          try {
            const generated = streamAnswer({
              query: message,
              locale,
              chunks,
              signal: generationAbort.signal,
            });
            // Generation stays buffered until its citations/tool calls pass the
            // safety gate. The browser receives one atomic terminal payload —
            // but it can honestly be told *how much* has been written without
            // being shown *what*, which is a real progress signal at no cost to
            // the gate.
            let written = 0;
            let lastReport = 0;
            let announcedWriting = false;
            for await (const delta of generated.textStream) {
              written += delta.length;
              if (!announcedWriting) {
                announcedWriting = true;
                status("writing");
              }
              const now = Date.now();
              if (now - lastReport >= 500) {
                lastReport = now;
                enqueue(write({ type: "progress", chars: written }));
              }
            }
            result = await generated.final();
            status("checking");
            const actual = result.usage
              ? estimateCostMicros(result.usage)
              : reserved;
            void addSpend(actual - reserved);
          } finally {
            void release();
          }
        }
        if (cancelled) return;
        const deterministicIssue =
          detectHighStakesIssue(message) ?? detectHighStakesIssue(normalizedQuery);
        result.escalated = result.escalated || Boolean(deterministicIssue);
        result.issueType ??= deterministicIssue;
        // `assisted` keeps the grounded answer and adds the referral; `danger`
        // already replaced the answer before it got here.
        result.severity ??= result.issueType && result.escalated
          ? escalationSeverity(result.issueType)
          : undefined;
        const referrals =
          result.escalated && result.issueType
            ? referralTargets(result.issueType)
            : [];

        // Persist the anonymised conversation + turn (best-effort — no DB in dev).
        let cid = conversationId;
        let assistantMessageId: string | undefined;
        let referralCode: string | undefined;
        let referralExpiresAt: string | undefined;
        // Captured during persistence, emitted AFTER the answer frame so no
        // analytics round trip sits between "answer ready" and "answer shown".
        let startedInfo: { newWorker: boolean } | undefined;
        let referralOrg: string | undefined;
        // "Delete my data" may have committed while this turn was generating.
        // Persisting now would resurrect rows under a session id whose cookie
        // the deletion response already expired — unreachable by any future
        // deletion request. Skip persistence; the answer itself still streams
        // back (without a conversation/message id, so feedback is disabled).
        if (await isSessionTombstoned(sid)) {
          // Tombstoned before persistence even started — don't echo the
          // client-supplied conversationId back either: it was only pattern-
          // validated, never confirmed to belong to this (now-erased) session.
          cid = undefined;
        } else try {
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
                // The partial unique index on (conversation_id) WHERE NOT
                // confirmed is the real guarantee; a concurrent turn that wins
                // the race simply leaves this turn without a (duplicate) code.
                const minted = await tx
                  .insert(referralsTable)
                  .values({
                    conversationId: activeConversationId,
                    issueType: result.issueType ?? "referral",
                    org: referrals.map((referral) => referral.org).join(", "),
                    outcome: "surfaced",
                    handoffCodeHash: hashHandoffCode(code),
                    expiresAt,
                  })
                  .onConflictDoNothing()
                  .returning({ id: referralsTable.id });
                if (minted.length > 0) handoff = { code, expiresAt };
              }
            }

            return {
              conversationId: activeConversationId,
              assistantMessageId: assistantId,
              started,
              handoff,
            };
          });

          // Re-check after commit: a "delete my data" request may have landed
          // during the transaction (its tombstone written before its delete, so
          // the pre-transaction check above could still miss it). If so, undo
          // this turn's rows and leave the response without ids so nothing is
          // attributed to a session the worker already erased.
          if (await isSessionTombstoned(sid)) {
            await deleteWorkerSessionData(sid);
            // Same reasoning as the pre-check skip above: leave the response
            // without ids so nothing is attributed to the erased session.
            cid = undefined;
          } else {
            cid = persisted.conversationId;
            assistantMessageId = persisted.assistantMessageId;
            referralCode = persisted.handoff?.code;
            referralExpiresAt = persisted.handoff?.expiresAt.toISOString();
            startedInfo = persisted.started;
            if (persisted.handoff) referralOrg = referrals[0].org;
          }
        } catch (persistenceError) {
          // No database configured — skip persistence, still answer the worker.
          if (process.env.DATABASE_URL) {
            await reportError(persistenceError, "api.chat.persistence");
          }
        }

        const delivered = enqueue(
          write({
            type: "done",
            text: result.text,
            conversationId: cid ?? null,
            messageId: assistantMessageId ?? null,
            citations: result.citations,
            escalated: result.escalated,
            // Lets the client frame a serious-but-answerable turn differently
            // from a crisis one, rather than treating all escalation alike.
            severity: result.severity ?? null,
            referrals,
            referralCode: referralCode ?? null,
            referralExpiresAt: referralExpiresAt ?? null,
          }),
        );
        if (!delivered) return;
        // Analytics run only after the worker has the answer. Batched so a slow
        // PostHog endpoint can't serialize into added latency, and settled (not
        // thrown) so an analytics failure never surfaces to the worker.
        const analytics: Promise<void>[] = [
          track(
            {
              type: "message_sent",
              locale,
              escalated: result.escalated,
              tokens: result.usage?.totalTokens,
            },
            { sessionId: sid },
          ),
        ];
        if (startedInfo) {
          analytics.push(
            track(
              { type: "conversation_started", locale, newWorker: startedInfo.newWorker },
              { sessionId: sid },
            ),
          );
        }
        if (referralOrg) {
          analytics.push(
            track({ type: "referral_created", org: referralOrg }, { sessionId: sid }),
          );
        }
        await Promise.allSettled(analytics);
      } catch (err) {
        if (cancelled || generationAbort.signal.aborted) return;
        await reportError(err, "api.chat");
        enqueue(
          write({ type: "error", message: "Unable to answer safely right now." }),
        );
      } finally {
        clearInterval(heartbeat);
        req.signal.removeEventListener("abort", abortGeneration);
        if (!cancelled) {
          try {
            controller.close();
          } catch {
            // The browser may have cancelled between the last enqueue and close.
          }
        }
      }
    },
    cancel() {
      abortGeneration();
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
