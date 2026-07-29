/**
 * Best-effort PII redaction, in two strengths.
 *
 * The distinction matters because these rules run on two very different paths:
 *
 * - {@link scrubIdentifiers} removes *structured* identifiers only — things
 *   with a shape, where a match is nearly always a real identifier. Safe to run
 *   on text the system still has to understand.
 * - {@link scrubPii} adds context-led heuristics for names, employers and
 *   addresses. These are deliberately greedy, so they are for text we only
 *   *store* — conversation logs, error reports, contract analyses.
 *
 * Running the greedy rules on text the system needs to understand destroys it.
 * "What can my employer deduct from my salary?" becomes "What can [employer
 * removed]?", which is not a question anyone can answer or retrieve against.
 *
 * Digits are matched as \p{Nd} (any script's decimal digits), never \d: the
 * audience types numbers with Bengali, Tamil, Thai, Burmese, and other native
 * keyboards, and ASCII-only rules would let exactly their PII through.
 */

/**
 * Structured identifiers: email, NRIC/FIN, passport, phone, long digit runs.
 * Each has a recognisable shape, so a match is very unlikely to be ordinary
 * prose, and removing one never changes what a sentence is asking.
 */
const IDENTIFIER_RULES: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]"],
  [/\b[STFGM](?:[\s-]?\p{Nd}){7}[\s-]?[A-Z]\b/giu, "[identity number removed]"],
  // Passport shapes across the served nationalities: 1-2 letters, 6-9 digits,
  // optional trailing letter (covers e.g. Myanmar MD123456, Philippine
  // P1234567A alongside the common letter+8-digit formats).
  [
    /(?<![\p{L}\p{Nd}])[A-Z]{1,2}\p{Nd}{6,9}[A-Z]?(?![\p{L}\p{Nd}])/giu,
    "[document number removed]",
  ],
  [/(?<!\p{Nd})(?:\+?65[\s-]?)?[689](?:[\s-]?\p{Nd}){7}(?!\p{Nd})/gu, "[phone removed]"],
  // Foreign phone numbers and other long digit runs (8+ digits, optional
  // leading + and separators) — the audience is foreign workers, so err toward
  // redaction. Digits split by non-space/-hyphen (e.g. dates 14/07/2026) survive.
  [/(?<![\w\p{Nd}])\+?\p{Nd}(?:[\s-]?\p{Nd}){7,}(?![\w\p{Nd}])/gu, "[number removed]"],
  [/(?<!\p{Nd})\p{Nd}{6}(?!\p{Nd})/gu, "[postal code removed]"],
];

/**
 * Context-led heuristics for unstructured PII. Greedy by design — they swallow
 * up to 60 characters after a trigger word — so they are only ever applied to
 * text on its way to storage, never to text the system must still act on.
 */
const HEURISTIC_RULES: Array<[RegExp, string]> = [
  [
    /\b(?:my\s+)?boss\s+(?:Mr|Mrs|Ms|Miss|Mdm|Madam|Dr)?\.?\s*[\p{L}][\p{L}'’-]*(?:\s+(?!of\b)[\p{L}][\p{L}'’-]*){0,2}\s+of\s+[\p{L}\p{N}][\p{L}\p{N}&'’., -]{1,60}(?=$|[;!?]|\s+(?:lives|works|who|where|and|but)\b)/giu,
    "[employer removed]",
  ],
  [
    /\b(?:my\s+)?(?:boss|employer|company|agency)\s+(?:is\s+|at\s+|called\s+)?[\p{L}\p{N}][\p{L}\p{N}&'’., -]{1,60}(?=$|[;!?]|\s+(?:and|but|who|where|because)\b)/giu,
    "[employer removed]",
  ],
  [
    /\b(?:Mr|Mrs|Ms|Miss|Mdm|Madam|Dr)\.?\s+[\p{L}][\p{L}'’-]*(?:\s+(?!of\b|at\b|from\b|who\b)[\p{L}][\p{L}'’-]*){0,3}/giu,
    "[name removed]",
  ],
  // The character class admits `[` and `]` so the rule still spans an address
  // that already had a postal code or phone number replaced by a `[... removed]`
  // token — identifier rules run first, and their output must not fragment this.
  [
    /\b(?:address|live|lives|stay|staying|dormitory|dorm)\s+(?:is\s+|at\s+|in\s+)?(?:block\s+|blk\s+)?\p{Nd}+[\p{L}\p{N}#'’,[\] /-]{2,80}?(?=$|[.;!?])/giu,
    "[address removed]",
  ],
];

function apply(rules: Array<[RegExp, string]>, text: string): string {
  return rules.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    text,
  );
}

/**
 * Remove structured identifiers, leaving the question intact.
 *
 * Use on text the system still has to understand: the retrieval query and the
 * message sent to the model. The provider receives the question either way, so
 * this is not a weaker privacy posture than sending it unscrubbed — it is the
 * same posture without the collateral damage.
 */
export function scrubIdentifiers(text: string): string {
  return apply(IDENTIFIER_RULES, text);
}

/**
 * Remove identifiers *and* likely names, employers and addresses.
 *
 * Use only on text being persisted or reported: conversation rows, contract
 * analyses, Sentry payloads.
 */
export function scrubPii(text: string): string {
  return apply(HEURISTIC_RULES, scrubIdentifiers(text));
}
