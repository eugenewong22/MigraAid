import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  createOpenAIEmbedder,
  createVoyageEmbedder,
  embeddingGeneration,
  validateEmbeddingBatch,
} from "@/lib/embeddings";

const vector = (value = 0) => Array<number>(EMBEDDING_DIMENSIONS).fill(value);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("embedding vector-space identity", () => {
  it("includes provider, model, and dimensions in the generation", () => {
    expect(embeddingGeneration("voyage", "voyage-3", 1024)).toBe(
      "voyage:voyage-3:1024",
    );
    expect(createOpenAIEmbedder({ apiKey: "test" }).generation).toBe(
      "openai:text-embedding-3-small:1024",
    );
  });

  it("preserves OpenAI response ordering and sends a request timeout signal", async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        request = init;
        return new Response(
          JSON.stringify({
            data: [
              { index: 1, embedding: vector(2) },
              { index: 0, embedding: vector(1) },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const embeddings = await createOpenAIEmbedder({ apiKey: "test" }).embed([
      "first",
      "second",
    ]);

    expect(embeddings[0][0]).toBe(1);
    expect(embeddings[1][0]).toBe(2);
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("embedding response validation", () => {
  it("aborts a provider request that exceeds its timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
      ),
    );

    await expect(
      createVoyageEmbedder({ apiKey: "test", timeoutMs: 1 }).embed(["text"]),
    ).rejects.toThrow("Voyage embeddings timed out");
  });

  it("rejects a provider response with a missing vector", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ embedding: vector() }] }), {
          status: 200,
        }),
      ),
    );

    await expect(
      createVoyageEmbedder({ apiKey: "test" }).embed(["first", "second"]),
    ).rejects.toThrow("returned 1 vectors; expected 2");
  });

  it("rejects wrong dimensions and non-finite values", () => {
    expect(() =>
      validateEmbeddingBatch([[1, 2]], 1, EMBEDDING_DIMENSIONS, "test"),
    ).toThrow("has 2 dimensions");

    const invalid = vector();
    invalid[10] = Number.NaN;
    expect(() =>
      validateEmbeddingBatch([invalid], 1, EMBEDDING_DIMENSIONS, "test"),
    ).toThrow("contains a non-finite value");
  });
});
