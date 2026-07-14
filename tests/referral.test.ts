import { describe, it, expect } from "vitest";
import { referralTargets } from "@/lib/referral/route";
import { telHref } from "@/lib/referral/emergency";

describe("referralTargets", () => {
  it("routes unpaid salary to TADM first", () => {
    const targets = referralTargets("unpaid_salary");
    expect(targets[0].org).toContain("TADM");
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
});
