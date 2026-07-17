/**
 * Best-effort PII redaction for persisted free text. It removes structured
 * identifiers plus conservative, context-led heuristics for names, employers,
 * and Singapore addresses. The original message is still used to answer, but
 * never reaches conversation logs unscrubbed.
 */
const RULES: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]"],
  [/\b[STFGM](?:[\s-]?\d){7}[\s-]?[A-Z]\b/gi, "[identity number removed]"],
  [/\b[A-Z]{1,2}\d{7,9}\b/gi, "[document number removed]"],
  [/(?<!\d)(?:\+?65[\s-]?)?[689](?:[\s-]?\d){7}(?!\d)/g, "[phone removed]"],
  // Foreign phone numbers and other long digit runs (8+ digits, optional
  // leading + and separators) — the audience is foreign workers, so err toward
  // redaction. Digits split by non-space/-hyphen (e.g. dates 14/07/2026) survive.
  [/(?<![\w])\+?\d(?:[\s-]?\d){7,}(?![\w])/g, "[number removed]"],
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
    /\b(?:address|live|lives|stay|staying|dormitory|dorm)\s+(?:is\s+|at\s+|in\s+)?(?:block\s+|blk\s+)?\d+[\p{L}\p{N}#'’, /-]{2,80}?(?=$|[.;!?])/giu,
    "[address removed]",
  ],
  [/(?<!\d)\d{6}(?!\d)/g, "[postal code removed]"],
];

export function scrubPii(text: string): string {
  return RULES.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    text,
  );
}
