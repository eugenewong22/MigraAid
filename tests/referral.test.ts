import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { isKnownIssueType, referralTargets } from "@/lib/referral/route";
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

  it("exposes a stable org slug so the client can localize the label", () => {
    // The card renders localized org names keyed on orgKey, not the English
    // `org` string — so every target must carry a slug.
    for (const target of referralTargets("unpaid_salary")) {
      expect(target.orgKey).toMatch(/^[a-z0-9]+$/);
    }
    expect(referralTargets("abuse_or_threats")[0].orgKey).toBe("police");
  });

  it("routes abuse/threats to the police first", () => {
    const targets = referralTargets("abuse_or_threats");
    expect(targets[0].org).toContain("Police");
  });

  it("falls back to HOME for an unknown issue", () => {
    const targets = referralTargets("something_unmapped");
    expect(targets[0].org).toContain("HOME");
  });

  it("survives inherited-property slugs and never echoes unknown slugs", () => {
    // Plain indexing made ISSUE_TO_ORGS["__proto__"] return a truthy
    // non-array, crashing .map mid-escalation; and an unknown slug used to be
    // interpolated verbatim into the user-visible referral reason.
    for (const slug of ["__proto__", "toString", "constructor", "hasOwnProperty"]) {
      const targets = referralTargets(slug);
      expect(targets[0].org).toContain("HOME");
      expect(targets[0].reason).not.toContain(slug);
    }
    expect(referralTargets("free text from a model").at(0)?.reason).toBe(
      "Support for migrant workers",
    );
  });

  it("accepts only allowlisted issue slugs", () => {
    expect(isKnownIssueType("unpaid_salary")).toBe(true);
    expect(isKnownIssueType("healthcare")).toBe(true);
    expect(isKnownIssueType("__proto__")).toBe(false);
    expect(isKnownIssueType("out_of_scope")).toBe(false);
    expect(isKnownIssueType(undefined)).toBe(false);
    expect(isKnownIssueType(42)).toBe(false);
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
        id: "policeSms",
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

  it("HMACs with a secret so a leaked table can't be offline-brute-forced with a public formula", () => {
    // Regression guard for the unsalted-SHA-256 finding: the previous scheme
    // hashed a hardcoded public prefix + the code, so anyone with a DB/backup
    // leak could brute-force the 60-bit code space entirely offline. The
    // fixed hash must depend on a server secret the leak alone doesn't give.
    const code = "MA-2345-6789-ABCD";
    const hash = hashHandoffCode(code);
    const oldUnsaltedScheme = createHash("sha256")
      .update(`migraaid-referral-v1:${code}`)
      .digest("hex");
    expect(hash).not.toBe(oldUnsaltedScheme);
    expect(hash).not.toContain(oldUnsaltedScheme);
  });

  it("uses a fixed 30-day expiry", () => {
    expect(handoffCodeExpiry(new Date("2026-07-14T00:00:00Z")).toISOString()).toBe(
      "2026-08-13T00:00:00.000Z",
    );
  });
});
