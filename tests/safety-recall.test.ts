/**
 * Recall and precision gates for the high-stakes detector.
 *
 * The unit tests in safety-match.test.ts prove the matching primitives work.
 * This proves the *configured rules* actually catch what a worker types, and —
 * just as importantly — that they do not fire `danger` on the ordinary
 * questions the corpus exists to answer.
 *
 * The two directions are not symmetric, which is the whole reason escalation
 * was split into two tiers:
 *
 *   missing a high-stakes question   a worker in trouble is handed a rule
 *                                    instead of a person. The worst outcome
 *                                    this product has.
 *   a false `danger`                 the worker loses their whole answer.
 *   a false `assisted`               the worker gets one extra banner.
 *
 * So recall is gated hard, false `danger` is gated at zero, and a stray
 * `assisted` on a negative is tolerated and merely reported.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectHighStakesIssue,
  escalationSeverity,
} from "@/lib/safety/policy";

interface Fixture {
  positives: Array<{ text: string; trigger: string; danger?: boolean }>;
  negatives: string[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(path.join(process.cwd(), "tests", "fixtures", "escalation.json"), "utf8"),
);

/** Recall below this means a real worker question goes unrouted. */
const MIN_RECALL = 0.95;

describe("high-stakes recall", () => {
  it("has enough cases to mean something", () => {
    expect(fixture.positives.length).toBeGreaterThanOrEqual(30);
    expect(fixture.negatives.length).toBeGreaterThanOrEqual(25);
  });

  it(`detects at least ${MIN_RECALL * 100}% of real high-stakes phrasings`, () => {
    const missed = fixture.positives.filter(
      (item) => detectHighStakesIssue(item.text) === undefined,
    );
    const recall = 1 - missed.length / fixture.positives.length;

    expect(
      recall,
      `missed:\n${missed.map((m) => `  ${m.text}`).join("\n")}`,
    ).toBeGreaterThanOrEqual(MIN_RECALL);
  });

  it("routes each phrasing to a sensible category", () => {
    // Not gated at 100%: several phrasings genuinely sit between two
    // categories, and any high-stakes routing is far better than none. What
    // matters is that a danger case is never downgraded.
    const wrong = fixture.positives.filter((item) => {
      const trigger = detectHighStakesIssue(item.text);
      return trigger !== undefined && trigger !== item.trigger;
    });
    expect(wrong.length / fixture.positives.length).toBeLessThan(0.2);
  });

  it("never downgrades a danger case to assisted", () => {
    // A worker whose passport has been taken must not be handed an answer and
    // a banner; they need the crisis wording and emergency contacts.
    for (const item of fixture.positives.filter((p) => p.danger)) {
      const trigger = detectHighStakesIssue(item.text);
      expect(trigger, item.text).toBeTruthy();
      expect(escalationSeverity(trigger!), item.text).toBe("danger");
    }
  });
});

describe("high-stakes precision", () => {
  it("never fires danger on an ordinary corpus question", () => {
    // A false danger costs the worker their entire answer, so this is gated at
    // zero rather than at a rate.
    const wrong = fixture.negatives.filter((text) => {
      const trigger = detectHighStakesIssue(text);
      return trigger !== undefined && escalationSeverity(trigger) === "danger";
    });
    expect(wrong, `falsely treated as danger:\n${wrong.join("\n")}`).toEqual([]);
  });

  it("keeps stray assisted escalations rare enough to be tolerable", () => {
    // These cost one extra banner, not the answer, so some are acceptable —
    // but a detector that escalates half the corpus is not useful either.
    const escalated = fixture.negatives.filter(
      (text) => detectHighStakesIssue(text) !== undefined,
    );
    expect(
      escalated.length / fixture.negatives.length,
      `escalated:\n${escalated.join("\n")}`,
    ).toBeLessThanOrEqual(0.2);
  });
});
