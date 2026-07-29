/**
 * Matching what a worker actually typed, rather than what a phrase list guessed.
 *
 * The original detector was literal substring matching over fixed phrases, so
 * `"work permit cancelled"` matched and `"work permit was cancelled"` did not.
 * Every natural variant needed its own entry, in eight languages, and the list
 * could never catch up. A high-stakes question that fails to escalate is the
 * most dangerous thing this product can do.
 *
 * Now that escalation is two-tier (see `escalationSeverity`), a false positive
 * on the `assisted` tier costs a worker one extra banner rather than their
 * whole answer — so recall can be pushed hard.
 *
 * Three layers, all pure and synchronous:
 *
 *   1. normalisation, careful about non-Latin scripts;
 *   2. term sequences with a gap budget, which collapse a family of phrasings
 *      into one rule;
 *   3. subject × predicate co-occurrence, for the long tail no list enumerates.
 */

/** Scripts written without spaces, where token-gap logic does not apply. */
const UNSEGMENTED = /[一-鿿㐀-䶿฀-๿က-႟]/;

export function hasUnsegmentedScript(text: string): boolean {
  return UNSEGMENTED.test(text);
}

/**
 * First code point of each decimal-digit block we serve. Digit blocks are
 * contiguous 0-9, so a value is `codePoint - base`. `Number("২")` is NaN — the
 * language will not do this for us.
 */
const DIGIT_ZEROS = [
  0x0030, // ASCII
  0x0660, // Arabic-Indic
  0x06f0, // Extended Arabic-Indic
  0x0966, // Devanagari
  0x09e6, // Bengali
  0x0be6, // Tamil
  0x0e50, // Thai
  0x1040, // Myanmar
];

function asciiDigit(char: string): string {
  const code = char.codePointAt(0);
  if (code === undefined) return char;
  for (const base of DIGIT_ZEROS) {
    if (code >= base && code <= base + 9) return String(code - base);
  }
  return char;
}

/**
 * Fold a query to a comparable form.
 *
 * Two things this must get right for a non-English audience:
 *
 * - Combining marks are **kept**. Bengali, Tamil, Thai and Burmese vowel signs
 *   are meaning-bearing; a filter that keeps only letters and digits silently
 *   turns "বেতন" into "ব তন". Only the Latin/Greek/Cyrillic combining block is
 *   stripped, which is what folds "café" without touching any other script.
 * - Digits are converted by code point, not by `Number()`.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/\p{Nd}/gu, asciiDigit)
    .replace(/[^\p{L}\p{M}\p{Nd}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeForMatch(text);
  return normalized ? normalized.split(" ") : [];
}

/**
 * A family of phrasings, expressed once.
 *
 * All `terms` must appear within a span of roughly `maxGap` tokens. So
 * `["work permit", "cancel"]` covers "work permit was cancelled", "they
 * cancelled my work permit next month" and "work permit is going to be
 * cancelled" — one rule instead of an unbounded list.
 *
 * Terms match as prefixes, so "cancel" covers cancelled/cancelling/cancellation.
 */
export interface TermSequence {
  terms: string[];
  maxGap?: number;
  /**
   * Require the terms in the written order. Off by default: "they cancelled my
   * work permit" and "my work permit was cancelled" are the same worry, and
   * with escalation split into two tiers, recall is the thing worth buying.
   */
  ordered?: boolean;
}

const DEFAULT_MAX_GAP = 5;

function matchesFrom(
  tokens: readonly string[],
  start: number,
  terms: readonly string[],
  maxGap: number,
): boolean {
  let index = start;
  for (const term of terms) {
    const parts = term.split(" ");
    let found = -1;
    const limit = Math.min(tokens.length, index + maxGap + parts.length);
    for (let i = index; i <= limit - parts.length; i += 1) {
      if (parts.every((part, offset) => tokens[i + offset]?.startsWith(part))) {
        found = i + parts.length;
        break;
      }
    }
    if (found === -1) return false;
    index = found;
  }
  return true;
}

/** Token index just past each occurrence of `term`, matched as a prefix. */
function occurrences(tokens: readonly string[], term: string): number[] {
  const parts = term.split(" ");
  const found: number[] = [];
  for (let i = 0; i + parts.length <= tokens.length; i += 1) {
    if (parts.every((part, offset) => tokens[i + offset]?.startsWith(part))) {
      found.push(i);
    }
  }
  return found;
}

export function matchesSequence(text: string, sequence: TermSequence): boolean {
  const maxGap = sequence.maxGap ?? DEFAULT_MAX_GAP;
  const normalizedTerms = sequence.terms.map((term) => normalizeForMatch(term));

  // Chinese, Thai and Burmese are not space-delimited, so token gaps are
  // meaningless — containment is the right test there.
  if (hasUnsegmentedScript(text)) {
    const haystack = normalizeForMatch(text).replace(/\s+/g, "");
    if (!sequence.ordered) {
      return normalizedTerms.every((term) =>
        haystack.includes(term.replace(/\s+/g, "")),
      );
    }
    let cursor = 0;
    for (const term of normalizedTerms) {
      const needle = term.replace(/\s+/g, "");
      const at = haystack.indexOf(needle, cursor);
      if (at === -1) return false;
      cursor = at + needle.length;
    }
    return true;
  }

  const tokens = tokenize(text);
  if (sequence.ordered) {
    for (let start = 0; start < tokens.length; start += 1) {
      if (matchesFrom(tokens, start, normalizedTerms, maxGap)) return true;
    }
    return false;
  }

  // Unordered: every term must appear, and the span containing all of them must
  // be tight enough that they are plausibly about the same thing.
  const positions = normalizedTerms.map((term) => occurrences(tokens, term));
  if (positions.some((list) => list.length === 0)) return false;

  const span = maxGap + normalizedTerms.length;
  const firsts = positions[0];
  return firsts.some((anchor) =>
    positions.every((list) =>
      list.some((position) => Math.abs(position - anchor) <= span),
    ),
  );
}

/**
 * A subject near a predicate, for the phrasings no list enumerates.
 *
 * "My employer did not pay me for 2 months" is not a phrase anyone would think
 * to add, but *salary-word near negation-word* catches it — and does not fire
 * on "when must my salary be paid", which has the subject and no predicate.
 */
export interface CoOccurrence {
  subjects: string[];
  predicates: string[];
  within?: number;
}

const DEFAULT_WITHIN = 8;

export function matchesCoOccurrence(
  text: string,
  rule: CoOccurrence,
): boolean {
  const subjects = rule.subjects.map(normalizeForMatch);
  const predicates = rule.predicates.map(normalizeForMatch);

  if (hasUnsegmentedScript(text)) {
    const haystack = normalizeForMatch(text).replace(/\s+/g, "");
    return (
      subjects.some((s) => haystack.includes(s.replace(/\s+/g, ""))) &&
      predicates.some((p) => haystack.includes(p.replace(/\s+/g, "")))
    );
  }

  const tokens = tokenize(text);
  const within = rule.within ?? DEFAULT_WITHIN;
  const positionsOf = (needles: string[]) => {
    const found: number[] = [];
    tokens.forEach((token, index) => {
      if (needles.some((needle) => token.startsWith(needle))) found.push(index);
    });
    return found;
  };

  const subjectAt = positionsOf(subjects);
  if (subjectAt.length === 0) return false;
  const predicateAt = positionsOf(predicates);
  if (predicateAt.length === 0) return false;

  return subjectAt.some((s) =>
    predicateAt.some((p) => Math.abs(s - p) <= within),
  );
}

export interface MatchRule {
  sequences?: TermSequence[];
  coOccurrences?: CoOccurrence[];
  /** Kept for phrasings that genuinely are fixed, e.g. an organisation name. */
  phrases?: string[];
}

export function matchesRule(text: string, rule: MatchRule): boolean {
  const normalized = normalizeForMatch(text);
  if (rule.phrases?.some((phrase) => normalized.includes(normalizeForMatch(phrase)))) {
    return true;
  }
  if (rule.sequences?.some((sequence) => matchesSequence(text, sequence))) {
    return true;
  }
  return Boolean(
    rule.coOccurrences?.some((rule_) => matchesCoOccurrence(text, rule_)),
  );
}
