/**
 * Fail-closed governance checks for repository-managed knowledge content.
 *
 * A checked-in Markdown file is not evidence that a partner NGO reviewed it.
 * The seed ingester may publish/index a file only when its frontmatter carries
 * an explicit publication decision, reviewer identity, review date, and a
 * canonical source reference or URL.
 */

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

const PLACEHOLDER = /^(?:todo|tbd|unknown|n\/a|none)$/i;
const REVIEW_DATE = /^\d{4}-\d{2}-\d{2}$/;

function nonPlaceholder(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && !PLACEHOLDER.test(normalized) ? normalized : undefined;
}

function validReviewDate(value: string | undefined, now: Date): string | undefined {
  const normalized = value?.trim();
  if (!normalized || !REVIEW_DATE.test(normalized)) return undefined;

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized ||
    parsed.getTime() > now.getTime()
  ) {
    return undefined;
  }
  return normalized;
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
  if (!reviewedBy) {
    reasons.push("reviewed_by must identify a reviewer or review team");
  }
  if (!reviewedAt) {
    reasons.push("reviewed_at must be a valid, non-future YYYY-MM-DD date");
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
