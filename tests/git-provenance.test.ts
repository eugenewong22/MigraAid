import { describe, expect, it } from "vitest";
import {
  parseCommitProvenance,
  provenanceLabel,
  resolveProvenance,
  type CommitProvenance,
} from "@/lib/content/git-provenance";
import type { ContentVerification } from "@/lib/content/verification";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const COMMIT: CommitProvenance = {
  sha: SHA,
  shortSha: SHA.slice(0, 12),
  author: "Eugene Wong <eugene@example.org>",
  committedAt: new Date("2026-07-20T09:30:00.000Z"),
};

const PUBLISHABLE: ContentVerification = {
  status: "published",
  publishable: true,
  reasons: [],
  sourceRef: "Employment Act 1968, s. 21",
};

const UNPUBLISHABLE: ContentVerification = {
  status: "draft",
  publishable: false,
  reasons: ['frontmatter status must explicitly be "published"'],
};

describe("parseCommitProvenance", () => {
  it("parses the NUL-delimited git log format", () => {
    const raw = `${SHA}\x00Eugene Wong <eugene@example.org>\x002026-07-20T09:30:00Z\n`;
    expect(parseCommitProvenance(raw)).toEqual({
      sha: SHA,
      shortSha: "0123456789ab",
      author: "Eugene Wong <eugene@example.org>",
      committedAt: new Date("2026-07-20T09:30:00Z"),
    });
  });

  it("keeps an author name containing the delimiter-adjacent characters intact", () => {
    const raw = `${SHA}\x00Ada O'Neill-Smith <ada+git@example.org>\x002026-01-02T03:04:05+08:00`;
    expect(parseCommitProvenance(raw)?.author).toBe(
      "Ada O'Neill-Smith <ada+git@example.org>",
    );
  });

  it.each([
    ["empty output (uncommitted file)", ""],
    ["whitespace only", "   \n"],
    ["missing fields", `${SHA}\x00only-author\n`],
    ["a short sha", `abc123\x00A <a@b.c>\x002026-07-20T09:30:00Z`],
    ["an unparseable date", `${SHA}\x00A <a@b.c>\x00not-a-date`],
  ])("returns null for %s", (_label, raw) => {
    expect(parseCommitProvenance(raw)).toBeNull();
  });
});

describe("provenanceLabel", () => {
  it("prefixes the short sha so the origin of the identity is obvious", () => {
    expect(provenanceLabel(COMMIT)).toBe(
      "git:0123456789ab Eugene Wong <eugene@example.org>",
    );
  });
});

describe("resolveProvenance", () => {
  it("gives an unpublishable file no governance identity", () => {
    expect(
      resolveProvenance({ verification: UNPUBLISHABLE, commit: COMMIT }),
    ).toEqual({
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      commitSha: null,
    });
  });

  it("attributes publication to the commit that last touched the file", () => {
    expect(resolveProvenance({ verification: PUBLISHABLE, commit: COMMIT })).toEqual(
      {
        reviewedBy: "git:0123456789ab Eugene Wong <eugene@example.org>",
        reviewedAt: COMMIT.committedAt,
        reviewNote: "Published from repository source",
        commitSha: SHA,
      },
    );
  });

  it("prefers an explicit review recorded in frontmatter over git attribution", () => {
    const result = resolveProvenance({
      verification: {
        ...PUBLISHABLE,
        reviewedBy: "HOME legal team",
        reviewedAt: "2026-07-14",
      },
      commit: COMMIT,
    });

    expect(result).toEqual({
      reviewedBy: "HOME legal team",
      reviewedAt: new Date("2026-07-14T00:00:00.000Z"),
      reviewNote: "Reviewed in repository governance metadata",
      commitSha: SHA,
    });
  });

  it.each([
    ["a reviewer with no date", { reviewedBy: "HOME legal team" }],
    ["a date with no reviewer", { reviewedAt: "2026-07-14" }],
  ])("falls back to git for half a review record: %s", (_label, half) => {
    const result = resolveProvenance({
      verification: { ...PUBLISHABLE, ...half },
      commit: COMMIT,
    });

    expect(result.reviewedBy).toBe(
      "git:0123456789ab Eugene Wong <eugene@example.org>",
    );
  });

  it("uses a stable identity with no date when git cannot attribute the file", () => {
    // A timestamp here would differ on every ingest run, making every item look
    // drifted and bumping its version forever.
    expect(resolveProvenance({ verification: PUBLISHABLE, commit: null })).toEqual({
      reviewedBy: "repository-source",
      reviewedAt: null,
      reviewNote: "Published from repository source (no git provenance)",
      commitSha: null,
    });
  });

  it("is stable across repeated calls, so re-ingesting is idempotent", () => {
    const first = resolveProvenance({ verification: PUBLISHABLE, commit: COMMIT });
    const second = resolveProvenance({ verification: PUBLISHABLE, commit: COMMIT });
    expect(first).toEqual(second);
  });
});
