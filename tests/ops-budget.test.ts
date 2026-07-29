import { describe, expect, it } from "vitest";
import {
  MICROS_PER_USD,
  budgetStatus,
  effectiveCeilingUsd,
  estimateCostMicros,
  microsToUsd,
  reservationMicros,
  spendKey,
  usdToMicros,
} from "@/lib/ops/budget";

describe("money is integer micro-dollars", () => {
  it("round-trips a dollar amount", () => {
    expect(usdToMicros(25)).toBe(25 * MICROS_PER_USD);
    expect(microsToUsd(usdToMicros(25))).toBe(25);
  });

  it("stays integral, so thousands of increments cannot drift", () => {
    expect(Number.isInteger(usdToMicros(0.0001))).toBe(true);
    expect(
      Number.isInteger(estimateCostMicros({ inputTokens: 137, outputTokens: 41 })),
    ).toBe(true);
  });
});

describe("estimateCostMicros", () => {
  it("prices input and output separately", () => {
    const inputOnly = estimateCostMicros({ inputTokens: 1_000_000, outputTokens: 0 });
    const outputOnly = estimateCostMicros({ inputTokens: 0, outputTokens: 1_000_000 });
    expect(inputOnly).toBe(2_500_000);
    expect(outputOnly).toBe(10_000_000);
    expect(
      estimateCostMicros({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe(inputOnly + outputOnly);
  });

  it("rounds up, so an estimate is never an under-count", () => {
    expect(estimateCostMicros({ inputTokens: 1, outputTokens: 0 })).toBe(3);
  });
});

describe("reservationMicros", () => {
  it("charges the full output budget before the call", () => {
    const reserved = reservationMicros({ inputTokens: 500, maxOutputTokens: 1_000 });
    const actual = estimateCostMicros({ inputTokens: 500, outputTokens: 200 });
    // A crashed request leaves the reservation in place: over-counting is the
    // safe direction to be wrong in.
    expect(reserved).toBeGreaterThan(actual);
  });
});

describe("budgetStatus", () => {
  const ceilingUsd = 10;
  const at = (usd: number) =>
    budgetStatus({ spentMicros: usdToMicros(usd), ceilingUsd });

  it.each([
    [0, "ok"],
    [6.9, "ok"],
    [7, "soft"],
    [9.9, "soft"],
    [10, "hard"],
    [14.9, "hard"],
    [15, "panic"],
  ])("classifies $%s as %s", (usd, state) => {
    expect(at(usd).state).toBe(state);
  });

  it("stops the expensive vision route first, keeping chat alive longer", () => {
    const soft = at(7);
    expect(soft.contractDisabled).toBe(true);
    expect(soft.degrade).toBe(false);
  });

  it("degrades the whole app at the ceiling", () => {
    expect(at(10).degrade).toBe(true);
    expect(at(15).degrade).toBe(true);
  });

  it("reports the fraction for the alert body", () => {
    expect(at(5).fraction).toBeCloseTo(0.5);
  });

  it("never degrades while a manual override is in force", () => {
    const overridden = budgetStatus({
      spentMicros: usdToMicros(999),
      ceilingUsd,
      overridden: true,
    });
    expect(overridden.state).toBe("ok");
    expect(overridden.degrade).toBe(false);
    expect(overridden.contractDisabled).toBe(false);
  });

  it("treats a negative counter as zero rather than going backwards", () => {
    expect(budgetStatus({ spentMicros: -5, ceilingUsd }).spentMicros).toBe(0);
  });

  it("does not divide by zero when no ceiling is configured", () => {
    const none = budgetStatus({ spentMicros: 1_000, ceilingUsd: 0 });
    expect(Number.isFinite(none.fraction)).toBe(true);
  });
});

describe("effectiveCeilingUsd", () => {
  it("prefers a flag override, so the ceiling can be raised without a deploy", () => {
    expect(effectiveCeilingUsd(50, 25)).toBe(50);
    expect(effectiveCeilingUsd(undefined, 25)).toBe(25);
    expect(effectiveCeilingUsd(undefined, undefined)).toBe(0);
  });
});

describe("spendKey", () => {
  it("is scoped to a calendar day so it expires on its own", () => {
    expect(spendKey("2026-07-28")).toBe("migraaid:spend:2026-07-28");
    expect(spendKey("2026-07-28")).not.toBe(spendKey("2026-07-29"));
  });
});
