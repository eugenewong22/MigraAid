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
  sourceUrl?: string | null;
  domain: Domain;
  text: string;
  /** Cosine similarity score (0–1). */
  score: number;
}

/** A span-level source attribution surfaced to the user. */
export interface Citation {
  sourceRef: string;
  sourceUrl?: string;
  contentItemId: string;
  quote?: string;
}

/** The result of answering a question over retrieved sources. */
export interface RagAnswer {
  text: string;
  citations: Citation[];
  escalated: boolean;
  /** Issue slug the model flagged when it escalated (drives referral routing). */
  issueType?: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface RetrieveOptions {
  query: string;
  locale: string;
  /** Pre-computed English-normalized + PII-scrubbed query; skips re-translation. */
  normalizedQuery?: string;
  domain?: Domain;
  limit?: number;
}

export interface AnswerOptions {
  query: string;
  locale: string;
  /** Retrieved sources, in the order they are passed to the model (document_index order). */
  chunks: RetrievedChunk[];
}
