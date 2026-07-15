import { describe, it, expect } from "vitest";
import { referralTargets } from "@/lib/referral/route";
import { contactHref, telHref } from "@/lib/referral/emergency";
import {
  generateHandoffCode,
  handoffCodeExpiry,
  hashHandoffCode,
  normalizeHandoffCode,
} from "@/lib/referral/handoff";

describe("referralTargets", () => {
  it("routes unpaid salary to TADM first", () => {
    const targets = referralTargets("unpaid_salary");
    expect(targets[0].org).toContain("TADM");
    expect(targets[0].href).toContain("tal.sg/tadm");
    expect(targets.length).toBeGreaterThan(0);
  });

  it("routes abuse/threats to the police first", () => {
    const targets = referralTargets("abuse_or_threats");
    expect(targets[0].org).toContain("Police");
  });

  it("falls back to HOME for an unknown issue", () => {
    const targets = referralTargets("something_unmapped");
    expect(targets[0].org).toContain("HOME");
  });
});

describe("telHref", () => {
  it("strips spaces but keeps + and digits", () => {
    expect(telHref("+65 6297 7564")).toBe("tel:+6562977564");
    expect(telHref("1800 339 5505")).toBe("tel:18003395505");
  });

  it("uses an explicit SMS link when supplied", () => {
    expect(
      contactHref({
        name: "Police emergency SMS",
        number: "70999",
        href: "sms:70999",
        category: "urgent",
      }),
    ).toBe("sms:70999");
  });
});

describe("privacy-preserving referral handoff codes", () => {
  it("generates a readable high-entropy code and normalizes user input", () => {
    const code = generateHandoffCode();
    expect(code).toMatch(/^MA-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(normalizeHandoffCode(code.toLowerCase().replaceAll("-", " "))).toBe(code);
  });

  it("hashes normalized equivalents without storing the raw code", () => {
    const code = "MA-2345-6789-ABCD";
    expect(hashHandoffCode(code)).toBe(hashHandoffCode("ma 2345 6789 abcd"));
    expect(hashHandoffCode(code)).not.toContain(code);
    expect(() => hashHandoffCode("MA-too-short")).toThrow();
  });

  it("uses a fixed 30-day expiry", () => {
    expect(handoffCodeExpiry(new Date("2026-07-14T00:00:00Z")).toISOString()).toBe(
      "2026-08-13T00:00:00.000Z",
    );
  });
});
