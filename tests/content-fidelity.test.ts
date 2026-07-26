import { describe, expect, it } from "vitest";
import {
  anchorOccursIn,
  checkFidelity,
  normalizeForComparison,
  numericTokens,
  styleViolations,
  unsupportedNumbers,
} from "@/lib/content/fidelity";

const SNAPSHOT = [
  "Paying salary",
  "In accordance with the Employment Act, your employer must pay your salary",
  "at least once a month and within 7 days after the end of the salary period.",
  "For overtime work, within 14 days after the end of the salary period.",
  "Not more than 25% of your 1 month’s salary may be deducted.",
].join("\n");

describe("anchorOccursIn", () => {
  it("accepts a passage copied verbatim", () => {
    expect(
      anchorOccursIn(SNAPSHOT, "within 7 days after the end of the salary period"),
    ).toBe(true);
  });

  it("accepts a passage rewrapped across lines", () => {
    expect(
      anchorOccursIn(
        SNAPSHOT,
        "your employer must pay your salary\n  at least once a month",
      ),
    ).toBe(true);
  });

  it("accepts a curly apostrophe typed as a straight one", () => {
    expect(anchorOccursIn(SNAPSHOT, "25% of your 1 month's salary")).toBe(true);
  });

  it("rejects a fabricated quotation", () => {
    // The whole point: a hallucinated rule cannot be a substring of the source.
    expect(
      anchorOccursIn(SNAPSHOT, "within 30 days after the end of the salary period"),
    ).toBe(false);
  });

  it("rejects an empty anchor rather than trivially passing", () => {
    expect(anchorOccursIn(SNAPSHOT, "   ")).toBe(false);
  });
});

describe("normalizeForComparison", () => {
  it("collapses whitespace, unifies punctuation and lowercases", () => {
    expect(normalizeForComparison("  A\n\tB “c” ‘d’ e–f ")).toBe('a b "c" \'d\' e-f');
  });
});

describe("numericTokens", () => {
  it("finds digits, percentages and number words alike", () => {
    expect(numericTokens("within 7 days, seven days, 25% and 1,000 dollars").sort()).toEqual(
      ["1000", "25%", "7"].sort(),
    );
  });

  it("normalises thousands separators", () => {
    expect(numericTokens("60,000")).toEqual(["60000"]);
  });
});

describe("unsupportedNumbers", () => {
  it("passes a paraphrase whose numbers all come from the source", () => {
    expect(
      unsupportedNumbers("Your salary must be paid within 7 days.", SNAPSHOT),
    ).toEqual([]);
  });

  it("accepts a number word where the source uses a digit", () => {
    expect(
      unsupportedNumbers("Your salary must be paid within seven days.", SNAPSHOT),
    ).toEqual([]);
  });

  it("catches the highest-harm error: a wrong deadline", () => {
    expect(
      unsupportedNumbers("Your salary must be paid within 30 days.", SNAPSHOT),
    ).toEqual(["30"]);
  });

  it("accepts a percentage written against a bare number in the source", () => {
    expect(unsupportedNumbers("up to 25% may be deducted", "up to 25 of salary")).toEqual(
      [],
    );
  });
});

describe("styleViolations", () => {
  it.each([
    "You should sue your employer.",
    "You will win this claim.",
    "This is guaranteed to work.",
    "I recommend filing today.",
    "This is legal advice.",
    "Don't worry, it is fine.",
  ])("refuses advice phrasing: %s", (text) => {
    expect(styleViolations(text).length).toBeGreaterThan(0);
  });

  it("accepts neutral, referring language", () => {
    expect(
      styleViolations(
        "If your salary is late, you can raise a claim with TADM. A migrant worker organisation can help you file it.",
      ),
    ).toEqual([]);
  });
});

describe("checkFidelity", () => {
  it("reports nothing for a faithful item", () => {
    expect(
      checkFidelity({
        paraphrase:
          "Your employer must pay your salary at least once a month, within 7 days after the salary period ends.",
        anchor:
          "your employer must pay your salary at least once a month and within 7 days after the end of the salary period",
        snapshot: SNAPSHOT,
      }),
    ).toEqual([]);
  });

  it("reports every kind of problem at once", () => {
    const problems = checkFidelity({
      paraphrase: "You should sue. Your salary must be paid within 30 days.",
      anchor: "your employer must pay you within 99 days",
      snapshot: SNAPSHOT,
    });

    expect(problems.map((p) => p.kind).sort()).toEqual([
      "anchor-not-in-snapshot",
      "style",
      "unsupported-number",
    ]);
  });
});
