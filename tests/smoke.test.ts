import { describe, it, expect } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@/lib/embeddings";
import { buildSystemPrompt, DISCLAIMER } from "@/lib/safety/prompt";

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
    expect(DISCLAIMER.length).toBeGreaterThan(0);
  });
});
