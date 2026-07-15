/**
 * Provider-agnostic embeddings.
 *
 * RAG retrieval uses a dedicated multilingual embedding provider. The
 * `Embedder` interface lets us
 * swap providers (Voyage ↔ OpenAI) without touching retrieval code.
 *
 * Default: Voyage `voyage-3` (multilingual, 1024-dim) — strong cross-lingual
 * retrieval so a Bengali/Tamil query can match the English source corpus.
 */

/** Embedding dimensionality. Must match the vector() column in the DB schema. */
export const EMBEDDING_DIMENSIONS = 1024;
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 12_000;

export type EmbeddingInputType = "query" | "document";

export interface Embedder {
  /** Provider name, useful for operational diagnostics without exposing content. */
  readonly provider: "voyage" | "openai";
  readonly model: string;
  readonly dimensions: number;
  /** Stable identity of the vector space persisted alongside every embedding. */
  readonly generation: string;
  embed(texts: string[], opts?: { inputType?: EmbeddingInputType }): Promise<number[][]>;
}

/**
 * A model name alone is not enough to identify a vector space: the provider and
 * requested output dimensionality are both material to cosine similarity.
 */
export function embeddingGeneration(
  provider: Embedder["provider"],
  model: string,
  dimensions: number,
): string {
  return `${provider}:${model}:${dimensions}`;
}

/** Validate untrusted provider output before it can reach pgvector. */
export function validateEmbeddingBatch(
  embeddings: unknown,
  expectedCount: number,
  expectedDimensions: number,
  provider: string,
): number[][] {
  if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) {
    throw new Error(
      `${provider} embeddings returned ${Array.isArray(embeddings) ? embeddings.length : "invalid"} vectors; expected ${expectedCount}`,
    );
  }

  for (let index = 0; index < embeddings.length; index += 1) {
    const vector = embeddings[index];
    if (!Array.isArray(vector) || vector.length !== expectedDimensions) {
      throw new Error(
        `${provider} embedding ${index} has ${Array.isArray(vector) ? vector.length : "invalid"} dimensions; expected ${expectedDimensions}`,
      );
    }
    if (vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`${provider} embedding ${index} contains a non-finite value`);
    }
  }

  return embeddings as number[][];
}

async function embeddingFetch(
  provider: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new Error(`${provider} embeddings timed out after ${timeoutMs}ms`, {
        cause: error,
      });
    }
    throw error;
  }
}

/** Voyage AI embedder (https://docs.voyageai.com). */
export function createVoyageEmbedder(opts?: {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): Embedder {
  const model = opts?.model ?? "voyage-3";
  const apiKey = opts?.apiKey ?? process.env.VOYAGE_API_KEY;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;

  return {
    provider: "voyage",
    model,
    dimensions: EMBEDDING_DIMENSIONS,
    generation: embeddingGeneration("voyage", model, EMBEDDING_DIMENSIONS),
    async embed(texts, embedOpts) {
      if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");
      if (texts.length === 0) return [];

      const res = await embeddingFetch(
        "Voyage",
        "https://api.voyageai.com/v1/embeddings",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            input: texts,
            model,
            input_type: embedOpts?.inputType ?? "document",
          }),
        },
        timeoutMs,
      );

      if (!res.ok) {
        throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
      return validateEmbeddingBatch(
        json.data?.map((d) => d.embedding),
        texts.length,
        EMBEDDING_DIMENSIONS,
        `Voyage ${model}`,
      );
    },
  };
}

/**
 * OpenAI embedder (text-embedding-3-small). Requests `dimensions: 1024` so the
 * output matches EMBEDDING_DIMENSIONS with no schema migration required — the
 * v3 embedding models are trained to support shortening this way.
 */
export function createOpenAIEmbedder(opts?: {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): Embedder {
  const model = opts?.model ?? "text-embedding-3-small";
  const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;

  return {
    provider: "openai",
    model,
    dimensions: EMBEDDING_DIMENSIONS,
    generation: embeddingGeneration("openai", model, EMBEDDING_DIMENSIONS),
    async embed(texts) {
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
      if (texts.length === 0) return [];

      const res = await embeddingFetch(
        "OpenAI",
        "https://api.openai.com/v1/embeddings",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            input: texts,
            model,
            dimensions: EMBEDDING_DIMENSIONS,
          }),
        },
        timeoutMs,
      );

      if (!res.ok) {
        throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };
      // The API guarantees the same order as input, but sort defensively.
      return validateEmbeddingBatch(
        json.data
          ?.sort((a, b) => a.index - b.index)
          .map((d) => d.embedding),
        texts.length,
        EMBEDDING_DIMENSIONS,
        `OpenAI ${model}`,
      );
    },
  };
}

let cached: Embedder | undefined;

/**
 * Returns the configured embedder. Voyage is preferred when both keys are
 * present (stronger multilingual/cross-lingual retrieval — see the plan);
 * otherwise falls back to OpenAI, so a deployment with only an OpenAI key
 * still works with no other changes.
 */
export function getEmbedder(): Embedder {
  if (!cached) {
    cached = process.env.VOYAGE_API_KEY
      ? createVoyageEmbedder()
      : createOpenAIEmbedder();
  }
  return cached;
}
