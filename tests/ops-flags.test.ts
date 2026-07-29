import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLAGS,
  UNREACHABLE_FLAGS,
  featureAllowed,
  isBudgetOverridden,
  parseFlags,
  type OpsFlags,
} from "@/lib/ops/flags";

const NOW = Date.parse("2026-07-28T00:00:00Z");

function flags(overrides: Partial<OpsFlags> = {}): OpsFlags {
  return { ...DEFAULT_FLAGS, disabled: new Set(), ...overrides };
}

describe("parseFlags", () => {
  it("defaults to full service on an empty store", () => {
    const parsed = parseFlags({});
    expect(parsed.mode).toBe("full");
    expect(parsed.disabled.size).toBe(0);
  });

  it.each(["full", "degraded", "off"])("accepts the %s mode", (mode) => {
    expect(parseFlags({ mode }).mode).toBe(mode);
  });

  it("falls back to full for an unrecognised mode rather than failing", () => {
    // A fat-fingered flag must not take the product down.
    expect(parseFlags({ mode: "DEGRADED" }).mode).toBe("full");
    expect(parseFlags({ mode: "banana" }).mode).toBe("full");
  });

  it("switches off only features explicitly set to off", () => {
    const parsed = parseFlags({ chat: "off", contract: "on", feedback: "" });
    expect([...parsed.disabled]).toEqual(["chat"]);
  });

  it("reads a budget override and an expiry", () => {
    const parsed = parseFlags({
      "budget.daily_usd": "50",
      "budget.override_until": "2026-07-28T06:00:00Z",
    });
    expect(parsed.dailyBudgetUsd).toBe(50);
    expect(parsed.overrideUntil).toBe(Date.parse("2026-07-28T06:00:00Z"));
  });

  it.each(["0", "-5", "lots", ""])("ignores a nonsense budget: %s", (value) => {
    expect(parseFlags({ "budget.daily_usd": value }).dailyBudgetUsd).toBeUndefined();
  });

  it("accepts a banner only as a message-catalog key", () => {
    expect(parseFlags({ "banner.key": "common.maintenance" }).bannerKey).toBe(
      "common.maintenance",
    );
  });

  it.each([
    "We are down, call 999 instead",
    "<script>alert(1)</script>",
    "nodots",
    "Common.Maintenance",
  ])("refuses free text as a banner: %s", (value) => {
    // The flag store must never be able to put prose in front of a worker.
    expect(parseFlags({ "banner.key": value }).bannerKey).toBeUndefined();
  });
});

describe("featureAllowed", () => {
  it("allows everything at full service", () => {
    for (const feature of ["chat", "contract", "feedback"] as const) {
      expect(featureAllowed(flags(), feature).allowed).toBe(true);
    }
  });

  it("refuses generative features when degraded", () => {
    const decision = featureAllowed(flags({ mode: "degraded" }), "chat");
    expect(decision).toEqual({ allowed: false, reason: "mode_degraded" });
  });

  it("refuses everything when off", () => {
    expect(featureAllowed(flags({ mode: "off" }), "chat").reason).toBe("mode_off");
  });

  it("refuses a single disabled feature while the rest keep working", () => {
    const f = flags({ disabled: new Set(["contract" as const]) });
    expect(featureAllowed(f, "contract").reason).toBe("feature_disabled");
    expect(featureAllowed(f, "chat").allowed).toBe(true);
  });
});

describe("UNREACHABLE_FLAGS", () => {
  it("degrades rather than serving, because an unreachable store means no ceiling either", () => {
    // No flag store means no rate limiting AND no spend accounting at the same
    // moment — precisely the conditions for an unbounded bill.
    expect(UNREACHABLE_FLAGS.mode).toBe("degraded");
    expect(featureAllowed(UNREACHABLE_FLAGS, "chat").allowed).toBe(false);
  });
});

describe("isBudgetOverridden", () => {
  it("is true only until the override expires", () => {
    expect(isBudgetOverridden(flags({ overrideUntil: NOW + 1000 }), NOW)).toBe(true);
    expect(isBudgetOverridden(flags({ overrideUntil: NOW - 1000 }), NOW)).toBe(false);
    expect(isBudgetOverridden(flags(), NOW)).toBe(false);
  });
});
