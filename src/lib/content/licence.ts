/**
 * When may the knowledge base store a *verbatim* excerpt of a source?
 *
 * Paraphrasing a public document with attribution is one thing; reproducing its
 * text is another, and the answer differs per source. This module makes that a
 * two-key decision:
 *
 *   1. A human reads the source's licence terms and records that in
 *      `content/sources.json` (`licence.verifiedBy` + `licence.verifiedAt`).
 *   2. Someone adds that licence id to {@link VERBATIM_EXCERPT_ALLOWLIST} below,
 *      which is a code change and therefore reviewed.
 *
 * A registry entry can *claim* a licence but can never *authorise itself*.
 * Nothing here asserts what any particular licence permits — that judgement is
 * the human step, and this module only records and enforces its outcome.
 *
 * Sources that are not allowlisted are still usable: their items are
 * paraphrase-only, with `source_ref` / `source_url` attribution.
 */
import { parsePastCalendarDate } from "@/lib/content/dates";
import { nonPlaceholder } from "@/lib/content/verification";
import type { SourceEntry } from "@/lib/content/sources";

/**
 * Licence ids cleared for verbatim excerpts.
 *
 * INTENTIONALLY EMPTY. Adding an id here is an assertion that someone read that
 * licence and concluded it permits reproducing the source text in this product.
 * Until that happens the corpus is paraphrase-only, which is the safe default.
 *
 * To add one: record the verification on the registry entry, add the id here,
 * and say in the PR who read the terms and what they concluded.
 */
export const VERBATIM_EXCERPT_ALLOWLIST: readonly string[] = [];

export interface ExcerptDecision {
  permitted: boolean;
  reason?: string;
}

/**
 * May we store a verbatim excerpt of this source? Fail-closed: an unknown
 * source, an unverified licence, or stale/placeholder verification all refuse.
 */
export function excerptPermitted(
  entry: SourceEntry | undefined,
  now = new Date(),
  allowlist: readonly string[] = VERBATIM_EXCERPT_ALLOWLIST,
): ExcerptDecision {
  if (!entry) {
    return { permitted: false, reason: "source_id does not resolve in the registry" };
  }
  if (!allowlist.includes(entry.licence.id)) {
    return {
      permitted: false,
      reason: `licence "${entry.licence.id}" is not cleared for verbatim excerpts`,
    };
  }
  if (!nonPlaceholder(entry.licence.verifiedBy)) {
    return {
      permitted: false,
      reason: `licence for "${entry.id}" records no verifier`,
    };
  }
  if (!parsePastCalendarDate(entry.licence.verifiedAt, now)) {
    return {
      permitted: false,
      reason: `licence for "${entry.id}" records no valid, non-future verification date`,
    };
  }
  return { permitted: true };
}

/** Throwing form, for write paths that must not silently drop the excerpt. */
export function assertExcerptPermitted(
  entry: SourceEntry | undefined,
  now = new Date(),
  allowlist: readonly string[] = VERBATIM_EXCERPT_ALLOWLIST,
): void {
  const decision = excerptPermitted(entry, now, allowlist);
  if (!decision.permitted) {
    throw new Error(`Verbatim excerpt not permitted: ${decision.reason}`);
  }
}
