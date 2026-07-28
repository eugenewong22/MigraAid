import { describe, it, expect } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@/lib/embeddings";
import { buildSystemPrompt } from "@/lib/safety/prompt";
import enMessages from "../messages/en.json";

describe("foundation", () => {
  it("embedding dimensions match the pgvector column", () => {
    expect(EMBEDDING_DIMENSIONS).toBe(1024);
  });

  it("builds a source-grounded, localized system prompt", () => {
    const prompt = buildSystemPrompt("bn");
    expect(prompt).toContain("MigraAid");
    expect(prompt).toContain("Bengali"); // answers in the worker's language
    expect(prompt.toLowerCase()).toContain("only using the information"); // grounding rule
  });

  it("exposes a user-facing disclaimer", () => {
    // Asserts the catalog key that is actually rendered. This used to check a
    // `DISCLAIMER` constant that no component consumed — two near-identical
    // texts, only one of which a worker ever saw, free to drift apart.
    expect(enMessages.home.disclaimer.length).toBeGreaterThan(0);
  });
});
