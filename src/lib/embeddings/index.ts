/**
 * Provider-agnostic embeddings.
 *
 * Anthropic does not offer an embeddings endpoint, so RAG retrieval uses a
 * separate multilingual embedding provider. The `Embedder` interface lets us
 * swap providers (Voyage ↔ Cohere) without touching retrieval code.
 *
 * Default: Voyage `voyage-3` (multilingual, 1024-dim) — strong cross-lingual
 * retrieval so a Bengali/Tamil query can match the English source corpus.
 */

/** Embedding dimensionality. Must match the vector() column in the DB schema. */
export const EMBEDDING_DIMENSIONS = 1024;

export type EmbeddingInputType = "query" | "document";

export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], opts?: { inputType?: EmbeddingInputType }): Promise<number[][]>;
}

/** Voyage AI embedder (https://docs.voyageai.com). */
export function createVoyageEmbedder(opts?: {
  apiKey?: string;
  model?: string;
}): Embedder {
  const model = opts?.model ?? "voyage-3";
  const apiKey = opts?.apiKey ?? process.env.VOYAGE_API_KEY;

  return {
    model,
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts, embedOpts) {
      if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");
      if (texts.length === 0) return [];

      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
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
      });

      if (!res.ok) {
        throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
      return json.data.map((d) => d.embedding);
    },
  };
}

let cached: Embedder | undefined;

/** Returns the configured embedder (Voyage by default). */
export function getEmbedder(): Embedder {
  if (!cached) cached = createVoyageEmbedder();
  return cached;
}
