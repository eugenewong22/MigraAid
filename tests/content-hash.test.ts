import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeContentHash } from "@/lib/content/hash";

const BODY = "Your employer must pay your salary within 7 days.";

describe("computeContentHash", () => {
  it("hashes an anchorless item exactly as the pre-excerpt ingester did", () => {
    // Back-compatibility: if this changes, every already-stored item looks
    // drifted on the next ingest and the whole corpus version-bumps at once.
    const legacy = createHash("sha256").update(BODY).digest("hex");
    expect(computeContentHash({ bodyMd: BODY })).toBe(legacy);
    expect(computeContentHash({ bodyMd: BODY, sourceExcerpt: null })).toBe(legacy);
    expect(computeContentHash({ bodyMd: BODY, sourceExcerpt: "   " })).toBe(legacy);
  });

  it("changes when only the excerpt changes, so an anchor fix forces re-review", () => {
    const a = computeContentHash({ bodyMd: BODY, sourceExcerpt: "seven days" });
    const b = computeContentHash({ bodyMd: BODY, sourceExcerpt: "fourteen days" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(computeContentHash({ bodyMd: BODY }));
  });

  it("changes when only the body changes", () => {
    expect(
      computeContentHash({ bodyMd: BODY, sourceExcerpt: "x" }),
    ).not.toBe(computeContentHash({ bodyMd: `${BODY} More.`, sourceExcerpt: "x" }));
  });

  it("is stable for identical input", () => {
    const input = { bodyMd: BODY, sourceExcerpt: "seven days" };
    expect(computeContentHash(input)).toBe(computeContentHash(input));
  });

  it("does not confuse a body/excerpt split with concatenated text", () => {
    expect(
      computeContentHash({ bodyMd: "ab", sourceExcerpt: "c" }),
    ).not.toBe(computeContentHash({ bodyMd: "a", sourceExcerpt: "bc" }));
  });
});
