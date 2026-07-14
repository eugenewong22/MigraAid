import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "@/lib/rag/chunk";

describe("chunkMarkdown", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkMarkdown("A short paragraph about rest days.");
    expect(chunks).toHaveLength(1);
  });

  it("splits long text into multiple bounded chunks", () => {
    const para = "word ".repeat(120); // ~600 chars
    const text = [para, para, para, para].join("\n\n"); // ~2400 chars
    const chunks = chunkMarkdown(text, { maxChars: 700 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      // Each packed chunk stays near the budget (a single long paragraph may exceed slightly).
      expect(c.length).toBeLessThanOrEqual(1500);
    }
  });

  it("drops empty paragraphs and preserves content", () => {
    const chunks = chunkMarkdown("First.\n\n\n\nSecond.");
    expect(chunks.join(" ")).toContain("First.");
    expect(chunks.join(" ")).toContain("Second.");
  });
});
