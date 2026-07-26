/**
 * Splitting a knowledge file into the part workers read and the part reviewers
 * check it against.
 *
 * A knowledge item is a plain-language paraphrase plus a verbatim excerpt of the
 * source provision it was derived from. Only the paraphrase is chunked and
 * embedded — the excerpt exists so a reviewer can confirm the paraphrase is
 * faithful, and so tests can prove the numbers in it are real. It must never
 * become retrievable: statutory English is not what this audience needs, and an
 * excerpt surfacing as an answer would defeat the point of paraphrasing.
 *
 * The split lives in the body rather than in frontmatter because the frontmatter
 * parser is line-oriented, so a multi-line quotation cannot be expressed there.
 */

/** Marks the start of the verbatim excerpt block. */
export const SOURCE_EXCERPT_DELIMITER = /^<!--\s*source-excerpt\s*-->\s*$/gm;

/**
 * Does this text contain a delimiter? Uses a fresh non-global regex: `.test()`
 * on the exported global one advances `lastIndex`, so consecutive calls would
 * alternate between true and false.
 */
export function containsExcerptDelimiter(text: string): boolean {
  return new RegExp(SOURCE_EXCERPT_DELIMITER.source, "m").test(text);
}

export interface SplitContent {
  /** The paraphrase. This is what gets chunked, embedded, and answered from. */
  bodyMd: string;
  /** The verbatim source provision, or null when the item is paraphrase-only. */
  sourceExcerpt: string | null;
}

/**
 * Split a knowledge file body on the source-excerpt delimiter.
 *
 * Fail-closed: anything ambiguous throws rather than guessing, because guessing
 * wrong here either drops a reviewer's evidence or embeds statutory text.
 */
export function splitSourceExcerpt(raw: string): SplitContent {
  const matches = [...raw.matchAll(SOURCE_EXCERPT_DELIMITER)];

  if (matches.length === 0) {
    const bodyMd = raw.trim();
    if (!bodyMd) throw new Error("content body is empty");
    return { bodyMd, sourceExcerpt: null };
  }

  if (matches.length > 1) {
    throw new Error(
      `expected at most one source-excerpt delimiter, found ${matches.length}`,
    );
  }

  const [match] = matches;
  const bodyMd = raw.slice(0, match.index).trim();
  const sourceExcerpt = raw.slice(match.index + match[0].length).trim();

  if (!bodyMd) {
    throw new Error("content body is empty before the source-excerpt delimiter");
  }
  // An empty block is a mistake — omit the delimiter to mean "no excerpt".
  if (!sourceExcerpt) {
    throw new Error("source-excerpt delimiter is present but the excerpt is empty");
  }

  return { bodyMd, sourceExcerpt };
}

/**
 * Strip Markdown blockquote markers so the excerpt can be compared against the
 * source snapshot it was copied from. Excerpts are conventionally quoted with
 * `>` for readability in a diff; that punctuation is ours, not the source's.
 */
export function unquoteExcerpt(excerpt: string): string {
  return excerpt
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join("\n")
    .trim();
}
