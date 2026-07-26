/**
 * The content hash that makes ingestion idempotent.
 *
 * The hash covers the verbatim excerpt as well as the paraphrase, so correcting
 * an excerpt bumps the item's version — and because a version bump clears
 * `submitted_by` / `reviewed_by`, an excerpt correction is treated as a real
 * change rather than a silent one.
 *
 * An item with no excerpt hashes to exactly `sha256(bodyMd)`, which is what the
 * ingester computed before excerpts existed. That keeps every already-stored
 * item's hash stable, so introducing excerpts does not churn the whole corpus.
 */
import { createHash } from "node:crypto";

const EXCERPT_SEPARATOR = "\n<!--source-excerpt-->\n";

export function computeContentHash(input: {
  bodyMd: string;
  sourceExcerpt?: string | null;
}): string {
  const excerpt = input.sourceExcerpt?.trim();
  const payload = excerpt
    ? `${input.bodyMd}${EXCERPT_SEPARATOR}${excerpt}`
    : input.bodyMd;
  return createHash("sha256").update(payload).digest("hex");
}
