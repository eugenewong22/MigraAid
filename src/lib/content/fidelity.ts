/**
 * Mechanical checks on a drafted knowledge item.
 *
 * A paraphrase of the law is written with model assistance, so the guards that
 * matter are the ones a model cannot talk its way past. These are all pure
 * string comparisons against the committed source snapshot:
 *
 * - the anchor must occur *verbatim* in the snapshot, which makes a fabricated
 *   quotation of a rule structurally impossible rather than merely unlikely;
 * - every number in the paraphrase must occur in the anchor, which catches the
 *   highest-harm error mode — "14 days" where the source says "seven days";
 * - advice phrasing is refused outright, because this product gives information
 *   and refers on, and must never read as a lawyer talking.
 *
 * What these cannot catch is overgeneralisation — stating a right without the
 * condition it depends on. That is why a human still edits before commit.
 */

/** Compare ignoring whitespace runs: our line wrapping is not the source's. */
export function normalizeForComparison(value: string): string {
  return value
    .replace(/\s+/g, " ")
    // Sources use typographic punctuation inconsistently between renderings.
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―]/g, "-")
    .trim()
    .toLowerCase();
}

/** Does this anchor actually appear in the snapshot it claims to come from? */
export function anchorOccursIn(snapshot: string, anchor: string): boolean {
  const needle = normalizeForComparison(anchor);
  if (!needle) return false;
  return normalizeForComparison(snapshot).includes(needle);
}

const NUMBER_WORDS = new Map<string, string>([
  ["one", "1"], ["two", "2"], ["three", "3"], ["four", "4"], ["five", "5"],
  ["six", "6"], ["seven", "7"], ["eight", "8"], ["nine", "9"], ["ten", "10"],
  ["eleven", "11"], ["twelve", "12"], ["fourteen", "14"], ["fifteen", "15"],
  ["twenty", "20"], ["thirty", "30"], ["sixty", "60"],
]);

/**
 * Numeric tokens in a text, normalised so "seven" and "7" compare equal and
 * "1,000" and "1000" compare equal.
 *
 * Ordinals and small counting words are excluded: "the first step" or "two
 * things to do" are prose, not claims about the law.
 */
export function numericTokens(text: string): string[] {
  const tokens = new Set<string>();

  for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?%?/g)) {
    tokens.add(match[0].replace(/,/g, ""));
  }
  for (const match of text.matchAll(/\b[a-z]+\b/gi)) {
    const word = NUMBER_WORDS.get(match[0].toLowerCase());
    if (word) tokens.add(word);
  }

  return [...tokens];
}

/**
 * Numbers asserted by the paraphrase that the anchor does not support.
 *
 * A percentage in the paraphrase is satisfied by the bare number in the anchor
 * ("25%" by "25"), because sources write the unit inconsistently.
 */
export function unsupportedNumbers(paraphrase: string, anchor: string): string[] {
  const supported = new Set(numericTokens(anchor));
  return numericTokens(paraphrase).filter((token) => {
    if (supported.has(token)) return false;
    const bare = token.replace(/%$/, "");
    return !supported.has(bare) && !supported.has(`${bare}%`);
  });
}

/**
 * Phrasings that turn information into advice, or promise an outcome.
 * MigraAid orients and refers; it does not tell a worker what to do legally.
 */
const BANNED_PHRASES: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /\byou should sue\b/i, why: "tells the worker to take legal action" },
  { pattern: /\byou will win\b/i, why: "promises an outcome" },
  { pattern: /\bguarantee(?:d|s)?\b/i, why: "promises an outcome" },
  { pattern: /\bi (?:advise|recommend)\b/i, why: "speaks as an adviser" },
  { pattern: /\bmy advice\b/i, why: "speaks as an adviser" },
  { pattern: /\bas your lawyer\b/i, why: "claims to be a lawyer" },
  { pattern: /\blegal advice\b/i, why: "characterises the answer as legal advice" },
  { pattern: /\bdon'?t worry\b/i, why: "reassures about a situation it cannot assess" },
  { pattern: /\balways\s+(?:safe|fine|legal)\b/i, why: "states an unqualified absolute" },
  { pattern: /\bnever\s+(?:a problem|illegal)\b/i, why: "states an unqualified absolute" },
];

export function styleViolations(text: string): string[] {
  return BANNED_PHRASES.filter(({ pattern }) => pattern.test(text)).map(
    ({ pattern, why }) => `${pattern.source}: ${why}`,
  );
}

export interface FidelityProblem {
  kind: "anchor-not-in-snapshot" | "unsupported-number" | "style";
  detail: string;
}

/** Every mechanical objection to a drafted item, in one pass. */
export function checkFidelity(input: {
  paraphrase: string;
  anchor: string;
  snapshot: string;
}): FidelityProblem[] {
  const problems: FidelityProblem[] = [];

  if (!anchorOccursIn(input.snapshot, input.anchor)) {
    problems.push({
      kind: "anchor-not-in-snapshot",
      detail: "the anchor is not a verbatim passage of the source snapshot",
    });
  }

  for (const token of unsupportedNumbers(input.paraphrase, input.anchor)) {
    problems.push({
      kind: "unsupported-number",
      detail: `"${token}" appears in the guidance but not in the source passage`,
    });
  }

  for (const violation of styleViolations(input.paraphrase)) {
    problems.push({ kind: "style", detail: violation });
  }

  return problems;
}
