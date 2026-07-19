/**
 * Vector retrieval over the published knowledge base (pgvector cosine).
 *
 * The corpus is authored in English (Singapore law is English). Cross-lingual
 * embedding quality varies a lot by provider: Voyage-3 embeds a native-language
 * query directly into the same space as the English corpus with strong recall,
 * but a general-purpose embedder (the OpenAI fallback used when no Voyage key
 * is configured) can score a correct English match well below an irrelevant
 * one for the same question asked in, say, Bengali or Tamil — confirmed on
 * this corpus: an English "Can my employer keep my passport?" scores 0.64
 * against the right document, the same question in Bengali only scores 0.22.
 * To keep retrieval reliable regardless of embedding provider, a non-English
 * query is first translated to English (a cheap, fast model call) and *that*
 * text is embedded for the vector search — the worker's original question is
 * still what the model sees and answers in when generating the response.
 */
import { and, asc, cosineDistance, eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import { getDb } from "@/lib/db";
import { contentChunks, contentItems } from "@/lib/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import type { RetrievedChunk, RetrieveOptions } from "./types";
import { reportError } from "@/lib/observability/sentry";
import { scrubPii } from "@/lib/safety/pii";

const NORMALIZE_MODEL = "gpt-5.6-terra";
// Kept small so normalize + embed + answer fit inside the route maxDuration.
const NORMALIZE_TIMEOUT_MS = 8_000;

/**
 * Translates a non-English query to English for embedding. Falls back to the
 * original text on any failure — a failed translation should degrade retrieval
 * quality, not break the request.
 */
export async function normalizeQueryForRetrieval(
  query: string,
  locale: string,
): Promise<string> {
  if (locale === "en") return query;
  try {
    // maxRetries:0 — a retry cannot fit the shared serverless time budget.
    const client = new OpenAI({ timeout: NORMALIZE_TIMEOUT_MS, maxRetries: 0 });
    const completion = await client.chat.completions.create({
      model: NORMALIZE_MODEL,
      store: false,
      max_completion_tokens: 120,
      reasoning_effort: "none",
      messages: [
        {
          role: "system",
          content:
            "Translate the user's message into concise English, preserving its meaning. " +
            "Reply with only the English translation — no notes, no quotes.",
        },
        { role: "user", content: query },
      ],
    });
    const translated = completion.choices[0]?.message.content?.trim();
    return translated || query;
  } catch (error) {
    // Availability-first fallback — but never a silent one: the English-
    // normalized text also feeds the deterministic high-stakes/injection
    // backstop, so a persistent normalize outage quietly weakens safety
    // coverage for non-English workers unless operators can see it.
    await reportError(error, "rag.normalize");
    return query;
  }
}

export async function retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  const embedder = getEmbedder();
  const normalizedQuery =
    opts.normalizedQuery ??
    (await normalizeQueryForRetrieval(scrubPii(opts.query), opts.locale));
  const [queryEmbedding] = await embedder.embed([normalizedQuery], {
    inputType: "query",
  });

  const db = getDb();
  // ORDER BY must be the bare ascending distance expression: pgvector's HNSW
  // index only serves `ORDER BY embedding <=> $q ASC LIMIT n`, and the planner
  // will not rewrite the equivalent `DESC(1 - distance)` — that form forced a
  // full sequential scan and sort on every chat turn as the corpus grows. The
  // similarity score is still computed for the grounding threshold.
  const distance = cosineDistance(contentChunks.embedding, queryEmbedding);
  const score = sql<number>`1 - (${distance})`;

  return db
    .select({
      chunkId: contentChunks.id,
      contentItemId: contentChunks.contentItemId,
      sourceRef: contentItems.sourceRef,
      sourceUrl: contentItems.sourceUrl,
      domain: contentItems.domain,
      text: contentChunks.chunkText,
      score,
    })
    .from(contentChunks)
    .innerJoin(contentItems, eq(contentChunks.contentItemId, contentItems.id))
    .where(
      and(
        eq(contentItems.status, "published"),
        eq(contentChunks.embeddingGeneration, embedder.generation),
        opts.domain ? eq(contentItems.domain, opts.domain) : undefined,
      ),
    )
    .orderBy(asc(distance))
    .limit(opts.limit ?? 6);
}
