import type { NextRequest } from "next/server";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { retrieve } from "@/lib/rag/retrieve";
import { streamAnswer } from "@/lib/rag/answer";
import { track } from "@/lib/analytics";

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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const raw = body as { message?: unknown; locale?: unknown };
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  const locale = hasLocale(routing.locales, raw.locale)
    ? raw.locale
    : routing.defaultLocale;

  if (!message) return new Response("Empty message", { status: 400 });

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
        controller.enqueue(
          write({
            type: "done",
            citations: result.citations,
            escalated: result.escalated,
          }),
        );
        track({ type: "message_sent", locale, escalated: result.escalated });
        // TODO(M6): persist the anonymised conversation + message for KPI analytics.
      } catch (err) {
        controller.enqueue(
          write({ type: "error", message: (err as Error).message }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
