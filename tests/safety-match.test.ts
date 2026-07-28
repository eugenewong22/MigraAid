import { describe, expect, it } from "vitest";
import {
  hasUnsegmentedScript,
  matchesCoOccurrence,
  matchesRule,
  matchesSequence,
  normalizeForMatch,
  tokenize,
} from "@/lib/safety/match";

describe("normalizeForMatch", () => {
  it("folds case, punctuation and whitespace", () => {
    expect(normalizeForMatch("  My  BOSS, he...  said!  ")).toBe("my boss he said");
  });

  it("converts any script's digits so amounts compare across keyboards", () => {
    expect(normalizeForMatch("২ মাস")).toContain("2");
    expect(normalizeForMatch("၂ လ")).toContain("2");
  });

  it("strips Latin diacritics", () => {
    expect(normalizeForMatch("café")).toBe("cafe");
  });

  it("keeps non-Latin combining marks, which are meaning-bearing", () => {
    // Stripping these corrupts the word rather than normalising it, and this
    // audience types in exactly these scripts.
    for (const text of ["বেতন", "சம்பளம்", "เงินเดือน", "လစာ"]) {
      expect(normalizeForMatch(text)).toBe(text.toLowerCase());
    }
  });
});

describe("tokenize", () => {
  it("returns nothing for empty or punctuation-only input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("!!! ???")).toEqual([]);
  });
});

describe("hasUnsegmentedScript", () => {
  it.each(["我的工资", "เงินเดือน", "လစာမပေး"])("detects %s", (text) => {
    expect(hasUnsegmentedScript(text)).toBe(true);
  });

  it.each(["my salary", "বেতন", "சம்பளம்"])("does not claim %s", (text) => {
    expect(hasUnsegmentedScript(text)).toBe(false);
  });
});

describe("matchesSequence", () => {
  const permitCancelled = { terms: ["work permit", "cancel"] };

  it.each([
    "my work permit cancelled",
    "my work permit was cancelled",
    "my work permit has been cancelled",
    "they cancelled my work permit",
    "my work permit is going to be cancelled next month",
    "Work Permit — CANCELLED!",
  ])("catches the variant: %s", (text) => {
    // The original literal list matched only the first of these.
    expect(matchesSequence(text, permitCancelled)).toBe(true);
  });

  it("matches a term as a prefix, covering inflections", () => {
    expect(matchesSequence("they are cancelling my work permit", permitCancelled)).toBe(
      true,
    );
  });

  it("does not fire when the terms are too far apart", () => {
    expect(
      matchesSequence(
        "my work permit is fine but a friend told me a long story about how his cousin had to cancel a trip",
        { terms: ["work permit", "cancel"], maxGap: 3 },
      ),
    ).toBe(false);
  });

  it("matches regardless of order, because both phrasings are the same worry", () => {
    expect(matchesSequence("they cancelled my work permit", permitCancelled)).toBe(true);
  });

  it("can require order when a rule genuinely needs it", () => {
    expect(
      matchesSequence("cancel my gym membership then renew work permit", {
        ...permitCancelled,
        ordered: true,
      }),
    ).toBe(false);
  });

  it("falls back to containment for unsegmented scripts", () => {
    // Chinese, Thai and Burmese have no spaces, so token gaps are meaningless.
    expect(matchesSequence("我的工作准证被取消了", { terms: ["工作准证", "取消"] })).toBe(true);
    expect(matchesSequence("取消了我的工作准证", { terms: ["工作准证", "取消"] })).toBe(true);
    expect(matchesSequence("我的工作准证还有效", { terms: ["工作准证", "取消"] })).toBe(false);
  });
});

describe("matchesCoOccurrence", () => {
  const unpaid = {
    subjects: ["salary", "wage", "pay"],
    predicates: ["not", "never", "owe", "withhold", "late", "short"],
  };

  it.each([
    "My employer did not pay me for 2 months",
    "I have not received my salary",
    "my boss never paid my wages",
    "salary is late again",
    "the company still owes me pay",
  ])("catches the long-tail phrasing: %s", (text) => {
    expect(matchesCoOccurrence(text, unpaid)).toBe(true);
  });

  it.each([
    "When must my salary be paid?",
    "How is my salary paid during sick leave?",
    "Who can claim overtime pay?",
  ])("does not fire on an ordinary question: %s", (text) => {
    // Subject present, no predicate — these are the corpus's own questions and
    // must keep reaching a grounded answer.
    expect(matchesCoOccurrence(text, unpaid)).toBe(false);
  });

  it("requires the two to be near each other", () => {
    const far =
      "my salary is fine and everything is good and life is nice but separately I should mention I do not like durian";
    expect(matchesCoOccurrence(far, { ...unpaid, within: 3 })).toBe(false);
  });

  it("works on unsegmented scripts by containment", () => {
    expect(
      matchesCoOccurrence("我的工资没发", { subjects: ["工资"], predicates: ["没发"] }),
    ).toBe(true);
  });
});

describe("matchesRule", () => {
  const rule = {
    phrases: ["tripartite alliance"],
    sequences: [{ terms: ["work permit", "cancel"] }],
    coOccurrences: [{ subjects: ["salary"], predicates: ["not"] }],
  };

  it("fires on any layer", () => {
    expect(matchesRule("about the Tripartite Alliance", rule)).toBe(true);
    expect(matchesRule("my work permit was cancelled", rule)).toBe(true);
    expect(matchesRule("I did not get my salary", rule)).toBe(true);
  });

  it("stays quiet when no layer matches", () => {
    expect(matchesRule("when is my rest day?", rule)).toBe(false);
  });

  it("handles an empty rule without matching everything", () => {
    expect(matchesRule("anything at all", {})).toBe(false);
  });
});
