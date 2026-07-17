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

  it("bounds a single oversized legal paragraph", () => {
    const text = Array.from(
      { length: 40 },
      (_, index) => `Sentence ${index + 1} explains a separate legal point.`,
    ).join(" ");
    const chunks = chunkMarkdown(text, { maxChars: 180 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 180)).toBe(true);
    expect(chunks.join(" ")).toContain("Sentence 40");
  });

  it("hard-splits long text without whitespace", () => {
    const chunks = chunkMarkdown("法".repeat(451), { maxChars: 100 });
    expect(chunks).toHaveLength(5);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
    expect(chunks.join("")).toBe("法".repeat(451));
  });

  it("keeps emoji and combining-character graphemes intact on hard splits", () => {
    const grapheme = "👩🏽‍🔧";
    const chunks = chunkMarkdown(grapheme.repeat(30), { maxChars: 25 });
    expect(chunks.join("")).toBe(grapheme.repeat(30));
    expect(chunks.every((chunk) => !chunk.startsWith("\u200d"))).toBe(true);
    expect(chunks.every((chunk) => !chunk.endsWith("\u200d"))).toBe(true);
  });

  it("recognizes Burmese and Thai break punctuation", () => {
    const text = `${"က".repeat(60)}။${"ခ".repeat(60)}ฯ${"ဂ".repeat(60)}`;
    const chunks = chunkMarkdown(text, { maxChars: 80 });
    expect(chunks.join("")).toBe(text);
    expect(chunks[0]).toMatch(/။$/u);
  });
});
