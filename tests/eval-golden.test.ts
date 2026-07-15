import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { preflightSafetyAnswer } from "@/lib/rag/answer";

interface GoldenItem {
  question: string;
  locale?: string;
  shouldEscalate?: boolean;
}

describe("golden safety evaluations", () => {
  it("routes every high-stakes golden case before retrieval/model calls", async () => {
    const items = JSON.parse(
      await readFile(path.join(process.cwd(), "eval", "golden.json"), "utf8"),
    ) as GoldenItem[];
    const highStakes = items.filter((item) => item.shouldEscalate);

    expect(highStakes.length).toBeGreaterThanOrEqual(8);
    for (const item of highStakes) {
      const result = preflightSafetyAnswer(
        item.question,
        item.locale ?? "en",
      );
      expect(result, `${item.locale ?? "en"}: ${item.question}`).toBeDefined();
      expect(result?.escalated).toBe(true);
    }
  });
});
