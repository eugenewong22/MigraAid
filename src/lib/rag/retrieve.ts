/**
 * Vector retrieval over the published knowledge base (pgvector cosine).
 *
 * The corpus is authored in English (Singapore law is English); a multilingual
 * embedder maps a native-language query into the same space, so a Bengali/Tamil
 * question can match English source chunks (cross-lingual retrieval).
 */
import { and, cosineDistance, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contentChunks, contentItems } from "@/lib/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import type { RetrievedChunk, RetrieveOptions } from "./types";

export async function retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  const embedder = getEmbedder();
  const [queryEmbedding] = await embedder.embed([opts.query], {
    inputType: "query",
  });

  const db = getDb();
  const score = sql<number>`1 - (${cosineDistance(contentChunks.embedding, queryEmbedding)})`;

  return db
    .select({
      chunkId: contentChunks.id,
      contentItemId: contentChunks.contentItemId,
      sourceRef: contentItems.sourceRef,
      domain: contentItems.domain,
      text: contentChunks.chunkText,
      score,
    })
    .from(contentChunks)
    .innerJoin(contentItems, eq(contentChunks.contentItemId, contentItems.id))
    .where(
      and(
        eq(contentItems.status, "published"),
        opts.domain ? eq(contentItems.domain, opts.domain) : undefined,
      ),
    )
    .orderBy(desc(score))
    .limit(opts.limit ?? 6);
}
