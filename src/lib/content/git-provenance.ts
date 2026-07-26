/**
 * Publication accountability, derived from git rather than hand-typed metadata.
 *
 * Repository content publishes without a named reviewer in its frontmatter, so
 * the record of *who* put a claim in front of workers, and *when*, comes from
 * the commit that last touched the file. The ingester stamps this onto every
 * published item and into the audit log, which makes each published vector
 * traceable back to a commit.
 *
 * This is deliberately best-effort: a shallow clone or an uncommitted working
 * copy yields no commit, and the caller falls back to a generic identity. It is
 * a provenance record, not a security control.
 */
import { execFileSync } from "node:child_process";
import type { ContentVerification } from "@/lib/content/verification";

export interface CommitProvenance {
  sha: string;
  shortSha: string;
  /** `Name <email>` exactly as git recorded it. */
  author: string;
  committedAt: Date;
}

/** Field separator: NUL can never appear inside any of the three fields. */
const FORMAT = "%H%x00%an <%ae>%x00%cI";

/**
 * Parse `git log` output in {@link FORMAT}. Exported for testing; returns null
 * for anything that does not parse cleanly rather than throwing, so a surprising
 * git output shape degrades to the fallback identity instead of failing ingest.
 */
export function parseCommitProvenance(raw: string): CommitProvenance | null {
  const line = raw.split("\n")[0]?.trim();
  if (!line) return null;

  const [sha, author, committedAt] = line.split("\0");
  if (!sha || !author || !committedAt) return null;
  if (!/^[0-9a-f]{40}$/.test(sha)) return null;

  const date = new Date(committedAt);
  if (Number.isNaN(date.getTime())) return null;

  return { sha, shortSha: sha.slice(0, 12), author, committedAt: date };
}

/**
 * The commit that last touched `filePath`, or null when git cannot tell us —
 * outside a checkout, in a shallow clone, or for a file that is not committed.
 */
export function lastCommitFor(filePath: string): CommitProvenance | null {
  try {
    const raw = execFileSync(
      "git",
      ["log", "-1", `--format=${FORMAT}`, "--", filePath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return parseCommitProvenance(raw);
  } catch {
    return null;
  }
}

/** The `reviewed_by` string written for a git-attributed publication. */
export function provenanceLabel(commit: CommitProvenance): string {
  return `git:${commit.shortSha} ${commit.author}`;
}

/** What the ingester writes into the governance columns of one item. */
export interface PublicationProvenance {
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  commitSha: string | null;
}

const NO_PROVENANCE: PublicationProvenance = {
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  commitSha: null,
};

/**
 * Resolve who is accountable for publishing an item, in descending order of
 * strength: an explicit review recorded in frontmatter, then the commit that
 * last touched the file, then a generic identity when git cannot tell us.
 *
 * An unpublishable file gets no identity at all — a draft is nobody's claim.
 */
export function resolveProvenance(input: {
  verification: ContentVerification;
  commit: CommitProvenance | null;
}): PublicationProvenance {
  const { verification, commit } = input;
  if (!verification.publishable) return NO_PROVENANCE;

  // Both halves must be present: a reviewer with no date, or a date with no
  // reviewer, is not a review record.
  if (verification.reviewedBy && verification.reviewedAt) {
    return {
      reviewedBy: verification.reviewedBy,
      reviewedAt: new Date(`${verification.reviewedAt}T00:00:00.000Z`),
      reviewNote: "Reviewed in repository governance metadata",
      commitSha: commit?.sha ?? null,
    };
  }

  if (commit) {
    return {
      reviewedBy: provenanceLabel(commit),
      reviewedAt: commit.committedAt,
      reviewNote: "Published from repository source",
      commitSha: commit.sha,
    };
  }

  // No date rather than "now": the ingest timestamp changes on every run, which
  // would make every item look drifted and bump its version forever.
  return {
    reviewedBy: "repository-source",
    reviewedAt: null,
    reviewNote: "Published from repository source (no git provenance)",
    commitSha: null,
  };
}
