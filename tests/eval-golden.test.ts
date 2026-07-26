import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { preflightSafetyAnswer } from "@/lib/rag/answer";
import { getSource, SOURCE_DOMAINS } from "@/lib/content/sources";
import { routing } from "@/i18n/routing";

interface GoldenItem {
  id?: string;
  question: string;
  locale?: string;
  domain?: string;
  mustCite?: boolean;
  shouldEscalate?: boolean;
  expectRefusal?: boolean;
  expectSourceId?: string;
  expectContains?: string[];
  tier?: "smoke" | "core" | "extended";
}

const golden: GoldenItem[] = JSON.parse(
  readFileSync(path.join(process.cwd(), "eval", "golden.json"), "utf8"),
);

const retrieval = golden.filter((item) => item.mustCite && !item.expectRefusal);

describe("golden set shape", () => {
  it("is large enough to be a real gate", () => {
    expect(golden.length).toBeGreaterThanOrEqual(65);
    expect(retrieval.length).toBeGreaterThanOrEqual(45);
  });

  it("gives every item a unique id", () => {
    const ids = golden.map((item) => item.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("expects a real registry source for every retrieval item", () => {
    for (const item of retrieval) {
      expect(item.expectSourceId, `${item.id}`).toBeTruthy();
      expect(getSource(item.expectSourceId), `${item.id}`).toBeDefined();
    }
  });

  it("expects a source that actually covers the domain it asks about", () => {
    for (const item of retrieval) {
      if (!item.domain) continue;
      expect(
        getSource(item.expectSourceId)?.domains,
        `${item.id}: source does not cover ${item.domain}`,
      ).toContain(item.domain);
    }
  });

  it("covers every domain", () => {
    const covered = new Set(retrieval.map((item) => item.domain));
    for (const domain of SOURCE_DOMAINS) {
      expect(covered.has(domain), `no retrieval item for ${domain}`).toBe(true);
    }
  });

  it("uses only locales the app actually routes", () => {
    for (const item of golden) {
      if (!item.locale) continue;
      expect(routing.locales as readonly string[]).toContain(item.locale);
    }
  });

  it("tests retrieval in languages other than English", () => {
    // The corpus is English; non-English questions are translated before
    // embedding. Nothing exercised that path while every non-English item was
    // an escalation case that short-circuits ahead of retrieval.
    const crossLingual = retrieval.filter(
      (item) => item.locale && item.locale !== "en",
    );
    expect(crossLingual.length).toBeGreaterThanOrEqual(6);
    expect(new Set(crossLingual.map((item) => item.locale)).size).toBeGreaterThanOrEqual(4);
  });

  it("tests that uncovered topics are still refused", () => {
    // As the corpus grows the risk shifts from answering too little to
    // improvising on topics there is no source for.
    expect(golden.filter((item) => item.expectRefusal).length).toBeGreaterThanOrEqual(8);
  });
});

describe("golden safety evaluations", () => {
  const highStakes = golden.filter((item) => item.shouldEscalate);

  it("routes every high-stakes golden case before retrieval/model calls", () => {
    expect(highStakes.length).toBeGreaterThanOrEqual(8);
    for (const item of highStakes) {
      const result = preflightSafetyAnswer(item.question, item.locale ?? "en");
      expect(result, `${item.locale ?? "en"}: ${item.question}`).toBeDefined();
      expect(result?.escalated).toBe(true);
    }
  });

  it("does not short-circuit any question meant to test retrieval", () => {
    // A retrieval item that trips a high-stakes phrase never reaches the index,
    // so it would silently stop testing what it was written to test.
    for (const item of retrieval) {
      expect(
        preflightSafetyAnswer(item.question, item.locale ?? "en"),
        `${item.id} escalates before retrieval`,
      ).toBeUndefined();
    }
  });

  it("does not short-circuit any refusal case either", () => {
    for (const item of golden.filter((i) => i.expectRefusal)) {
      expect(
        preflightSafetyAnswer(item.question, item.locale ?? "en"),
        `${item.id} escalates instead of reaching the grounding gate`,
      ).toBeUndefined();
    }
  });
});
