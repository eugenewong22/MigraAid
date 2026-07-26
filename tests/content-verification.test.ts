import { describe, expect, it } from "vitest";
import { verifyContentFrontmatter } from "@/lib/content/verification";

const NOW = new Date("2026-07-14T12:00:00.000Z");

const REVIEWED = {
  status: "published",
  reviewed_by: "Partner NGO legal review team",
  reviewed_at: "2026-07-14",
  source_ref: "Employment Act 1968, s. 21",
};

describe("verifyContentFrontmatter", () => {
  it("publishes only content carrying explicit review evidence", () => {
    expect(verifyContentFrontmatter(REVIEWED, NOW)).toMatchObject({
      status: "published",
      publishable: true,
      reasons: [],
      reviewedBy: "Partner NGO legal review team",
      reviewedAt: "2026-07-14",
      sourceRef: "Employment Act 1968, s. 21",
    });
  });

  it("holds the legacy seed frontmatter shape for its missing publication decision", () => {
    const result = verifyContentFrontmatter(
      {
        title: "When must my salary be paid?",
        source_ref: "Employment Act — salary payment",
      },
      NOW,
    );

    expect(result.status).toBe("draft");
    expect(result.publishable).toBe(false);
    expect(result.reasons).toEqual([
      'frontmatter status must explicitly be "published"',
    ]);
  });

  it("publishes without reviewer metadata — accountability comes from git", () => {
    const result = verifyContentFrontmatter(
      {
        title: "When must my salary be paid?",
        status: "published",
        source_ref: "Employment Act 1968, s. 21",
      },
      NOW,
    );

    expect(result).toMatchObject({
      status: "published",
      publishable: true,
      reasons: [],
      reviewedBy: undefined,
      reviewedAt: undefined,
    });
  });

  it("keeps an explicit draft de-indexed even when review fields are present", () => {
    const result = verifyContentFrontmatter(
      { ...REVIEWED, status: "draft" },
      NOW,
    );

    expect(result.status).toBe("draft");
    expect(result.publishable).toBe(false);
    expect(result.reasons).toContain(
      'frontmatter status must explicitly be "published"',
    );
  });

  it("drops placeholder reviewer evidence without blocking publication", () => {
    const missing = verifyContentFrontmatter(
      { ...REVIEWED, reviewed_by: "" },
      NOW,
    );
    const placeholder = verifyContentFrontmatter(
      { ...REVIEWED, reviewed_by: "TBD" },
      NOW,
    );

    // Publishable, but the bogus evidence must not survive as if it were real:
    // resolveProvenance falls back to git attribution when reviewedBy is unset.
    expect(missing).toMatchObject({ publishable: true, reviewedBy: undefined });
    expect(placeholder).toMatchObject({
      publishable: true,
      reviewedBy: undefined,
    });
  });

  it.each(["2026-02-30", "14 July 2026", "2026-07-15"])(
    "drops an invalid or future review date without blocking publication: %s",
    (reviewedAt) => {
      const result = verifyContentFrontmatter(
        { ...REVIEWED, reviewed_at: reviewedAt },
        NOW,
      );

      expect(result.status).toBe("published");
      expect(result.publishable).toBe(true);
      expect(result.reviewedAt).toBeUndefined();
    },
  );

  it("accepts a canonical HTTPS source URL when a textual reference is unsuitable", () => {
    const result = verifyContentFrontmatter(
      {
        ...REVIEWED,
        source_ref: "",
        source_url: "https://www.mom.gov.sg/employment-practices/salary",
      },
      NOW,
    );

    expect(result).toMatchObject({
      status: "published",
      publishable: true,
      sourceUrl: "https://www.mom.gov.sg/employment-practices/salary",
    });
  });

  it("rejects missing, placeholder, or insecure source metadata", () => {
    const missing = verifyContentFrontmatter(
      { ...REVIEWED, source_ref: "unknown" },
      NOW,
    );
    const insecure = verifyContentFrontmatter(
      { ...REVIEWED, source_url: "http://example.org/source" },
      NOW,
    );

    expect(missing.status).toBe("draft");
    expect(missing.reasons).toContain(
      "source_ref or source_url must identify the canonical source",
    );
    expect(insecure.status).toBe("draft");
    expect(insecure.reasons).toContain(
      "source_url must be an absolute HTTPS URL without credentials",
    );
  });
});
