import { describe, expect, it } from "vitest";
import { knowledgeReadiness } from "@/lib/health/readiness";

describe("knowledge readiness", () => {
  it("requires at least one published item and current vectors for every item", () => {
    expect(knowledgeReadiness([], []).ready).toBe(false);
    expect(knowledgeReadiness(["a", "b"], ["a"]).ready).toBe(false);
    expect(knowledgeReadiness(["a", "b"], ["b", "a", "a"]).ready).toBe(true);
  });
});
