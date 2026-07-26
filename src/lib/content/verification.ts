/**
 * Fail-closed provenance checks for repository-managed knowledge content.
 *
 * The repository is the source of truth for the corpus: the seed ingester may
 * publish/index a file when its frontmatter carries an explicit publication
 * decision and a canonical source reference or URL. Accountability for what was
 * published comes from git authorship (see `git-provenance.ts`), which the
 * ingester records on every item, rather than from hand-typed reviewer metadata.
 *
 * `reviewed_by` / `reviewed_at` remain *optional evidence*: an item that did get
 * an expert review can still record it, and it is surfaced in the admin CMS.
 * They are no longer required for publication.
 */

import { parsePastCalendarDate } from "@/lib/content/dates";

export type ContentFrontmatter = Record<string, string | undefined>;

export interface ContentVerification {
  /** Database status the ingester must use. Invalid/unreviewed content is draft. */
  status: "draft" | "published";
  publishable: boolean;
  reasons: string[];
  reviewedBy?: string;
  reviewedAt?: string;
  sourceRef?: string;
  sourceUrl?: string;
}

export const PLACEHOLDER = /^(?:todo|tbd|unknown|n\/a|none)$/i;

/** Trimmed value, unless it is empty or obvious placeholder text. */
export function nonPlaceholder(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && !PLACEHOLDER.test(normalized) ? normalized : undefined;
}

function validReviewDate(value: string | undefined, now: Date): string | undefined {
  return parsePastCalendarDate(value, now) ? value?.trim() : undefined;
}

function validCanonicalUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  try {
    const parsed = new URL(normalized);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/**
 * Evaluate Markdown frontmatter for publication. Every failed check returns a
 * draft status, so callers cannot accidentally turn malformed metadata into a
 * published vector.
 *
 * Invalid `reviewed_by` / `reviewed_at` values are dropped rather than treated
 * as fatal — they are optional evidence, so malformed evidence must not be able
 * to masquerade as real evidence, but it also must not block publication.
 */
export function verifyContentFrontmatter(
  metadata: ContentFrontmatter,
  now = new Date(),
): ContentVerification {
  const reasons: string[] = [];
  const reviewedBy = nonPlaceholder(metadata.reviewed_by);
  const reviewedAt = validReviewDate(metadata.reviewed_at, now);
  const sourceRef = nonPlaceholder(metadata.source_ref);
  const rawSourceUrl = metadata.source_url?.trim();
  const sourceUrl = validCanonicalUrl(rawSourceUrl);

  if (metadata.status?.trim() !== "published") {
    reasons.push('frontmatter status must explicitly be "published"');
  }
  if (!sourceRef && !sourceUrl) {
    reasons.push("source_ref or source_url must identify the canonical source");
  }
  if (rawSourceUrl && !sourceUrl) {
    reasons.push("source_url must be an absolute HTTPS URL without credentials");
  }

  const publishable = reasons.length === 0;
  return {
    status: publishable ? "published" : "draft",
    publishable,
    reasons,
    reviewedBy,
    reviewedAt,
    sourceRef,
    sourceUrl,
  };
}
