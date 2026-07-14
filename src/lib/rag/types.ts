/**
 * Shared RAG types. The retrieve→generate implementation lands in M1
 * (lib/rag/retrieve.ts, lib/rag/answer.ts); these contracts are stable now so
 * the rest of the app can depend on them.
 */
import type { domainEnum } from "@/lib/db/schema";

export type Domain = (typeof domainEnum.enumValues)[number];

/** A chunk returned by vector retrieval, with its source for citation. */
export interface RetrievedChunk {
  chunkId: string;
  contentItemId: string;
  sourceRef: string;
  domain: Domain;
  text: string;
  /** Cosine similarity score (0–1). */
  score: number;
}

/** A span-level source attribution surfaced to the user. */
export interface Citation {
  sourceRef: string;
  contentItemId: string;
  quote?: string;
}

/** The result of answering a question over retrieved sources. */
export interface RagAnswer {
  text: string;
  citations: Citation[];
  escalated: boolean;
  model: string;
}

export interface RetrieveOptions {
  query: string;
  locale: string;
  domain?: Domain;
  limit?: number;
}
