import { describe, expect, it } from "vitest";
import {
  VERBATIM_EXCERPT_ALLOWLIST,
  assertExcerptPermitted,
  excerptPermitted,
} from "@/lib/content/licence";
import { loadSourceRegistry, type SourceEntry } from "@/lib/content/sources";

const NOW = new Date("2026-07-26T00:00:00.000Z");
const ALLOWED = ["open-licence"];

function entry(licence: Partial<SourceEntry["licence"]> = {}): SourceEntry {
  return {
    id: "example-source",
    licence: {
      id: "open-licence",
      name: "Open Licence",
      url: "https://example.org/licence",
      note: "Verified.",
      verifiedBy: "Eugene Wong",
      verifiedAt: "2026-07-01",
      ...licence,
    },
  } as SourceEntry;
}

describe("excerptPermitted", () => {
  it("permits an allowlisted licence with a complete, past verification", () => {
    expect(excerptPermitted(entry(), NOW, ALLOWED)).toEqual({ permitted: true });
  });

  it.each([
    ["an unknown source", undefined, /does not resolve/],
    [
      "a licence that is not allowlisted",
      entry({ id: "all-rights-reserved" }),
      /not cleared for verbatim excerpts/,
    ],
    ["no recorded verifier", entry({ verifiedBy: undefined }), /records no verifier/],
    ["a placeholder verifier", entry({ verifiedBy: "TBD" }), /records no verifier/],
    [
      "no verification date",
      entry({ verifiedAt: undefined }),
      /no valid, non-future verification date/,
    ],
    [
      "a future verification date",
      entry({ verifiedAt: "2027-01-01" }),
      /no valid, non-future verification date/,
    ],
    [
      "an impossible verification date",
      entry({ verifiedAt: "2026-02-30" }),
      /no valid, non-future verification date/,
    ],
  ])("refuses %s", (_label, input, pattern) => {
    const decision = excerptPermitted(input, NOW, ALLOWED);
    expect(decision.permitted).toBe(false);
    expect(decision.reason).toMatch(pattern);
  });

  it("throws from the asserting form, naming the reason", () => {
    expect(() => assertExcerptPermitted(undefined, NOW, ALLOWED)).toThrow(
      /Verbatim excerpt not permitted/,
    );
    expect(() => assertExcerptPermitted(entry(), NOW, ALLOWED)).not.toThrow();
  });
});

describe("the shipped allowlist", () => {
  it("only contains licence ids that some registry entry actually declares", () => {
    const declared = new Set(loadSourceRegistry().map((e) => e.licence.id));
    for (const id of VERBATIM_EXCERPT_ALLOWLIST) {
      expect(declared.has(id), `allowlisted licence "${id}" is unused`).toBe(true);
    }
  });

  it("refuses verbatim excerpts for every registry source that lacks a verification", () => {
    // A registry entry can claim a licence but never authorise itself: clearing
    // one requires both a recorded human verification and a code change here.
    for (const source of loadSourceRegistry()) {
      if (source.licence.verifiedBy && source.licence.verifiedAt) continue;
      expect(
        excerptPermitted(source, NOW).permitted,
        `${source.id} must not permit excerpts without a recorded verification`,
      ).toBe(false);
    }
  });
});
