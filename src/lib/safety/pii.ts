/**
 * Best-effort PII redaction for persisted free text. It removes structured
 * identifiers: emails, SG NRIC/FIN, permit/passport-shaped tokens, and phone /
 * long digit runs (including foreign numbers). It does NOT remove unstructured
 * PII such as personal names, employer/company names, or addresses — so callers
 * that persist worker text must ALSO minimise what they store and keep retention
 * short. The original message is still used to answer, but never reaches
 * conversation logs unscrubbed.
 */
const RULES: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]"],
  [/\b[STFGM]\d{7}[A-Z]\b/gi, "[identity number removed]"],
  [/\b[A-Z]{1,2}\d{7,9}\b/gi, "[document number removed]"],
  [/(?<!\d)(?:\+?65[\s-]?)?[689](?:[\s-]?\d){7}(?!\d)/g, "[phone removed]"],
  // Foreign phone numbers and other long digit runs (8+ digits, optional
  // leading + and separators) — the audience is foreign workers, so err toward
  // redaction. Digits split by non-space/-hyphen (e.g. dates 14/07/2026) survive.
  [/(?<![\w])\+?\d(?:[\s-]?\d){7,}(?![\w])/g, "[number removed]"],
];

export function scrubPii(text: string): string {
  return RULES.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    text,
  );
}
