/**
 * Best-effort PII redaction for persisted free text. It removes structured
 * identifiers plus conservative, context-led heuristics for names, employers,
 * and Singapore addresses. The original message is still used to answer, but
 * never reaches conversation logs unscrubbed.
 *
 * Digits are matched as \p{Nd} (any script's decimal digits), never \d: the
 * audience types numbers with Bengali, Tamil, Thai, Burmese, and other native
 * keyboards, and ASCII-only rules would let exactly their PII through.
 */
const RULES: Array<[RegExp, string]> = [
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
  [
    /\b(?:address|live|lives|stay|staying|dormitory|dorm)\s+(?:is\s+|at\s+|in\s+)?(?:block\s+|blk\s+)?\p{Nd}+[\p{L}\p{N}#'’, /-]{2,80}?(?=$|[.;!?])/giu,
    "[address removed]",
  ],
  [/(?<!\p{Nd})\p{Nd}{6}(?!\p{Nd})/gu, "[postal code removed]"],
];

export function scrubPii(text: string): string {
  return RULES.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    text,
  );
}
