/**
 * Source snapshots: what a public document said on the day it was read.
 *
 * A knowledge item's anchor is only trustworthy if we can show where it came
 * from. A snapshot is a committed, plain-text copy of the source, digested by
 * the sha256 of the *raw response bytes* so a later re-fetch can tell whether
 * the document changed underneath us.
 *
 * The text extraction here is deliberately crude. It exists so a human can read
 * the snapshot and a test can assert an anchor occurs in it — not to reproduce
 * the page. Anything needing real fidelity should read the canonical URL.
 */
import { createHash } from "node:crypto";
import path from "node:path";

/** Digest of the exact bytes received, before any extraction or normalisation. */
export function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function snapshotPathFor(sourceId: string, retrievedAt: string): string {
  return path.posix.join("content", "_snapshots", sourceId, `${retrievedAt}.txt`);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code = entity[1]?.toLowerCase() === "x"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Reduce an HTML document to readable text: drop non-content elements, turn
 * block boundaries into newlines, decode entities, and collapse runs of blank
 * space so a diff of two snapshots shows real changes rather than reflowing.
 */
export function htmlToText(html: string): string {
  const withoutNonContent = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ");

  // Flatten the source's own line breaks first. Newlines in the markup are
  // formatting, not structure — only the breaks inserted below are structure,
  // so a page that reflows must not read as a content change.
  const flattened = withoutNonContent.replace(/\s+/g, " ");

  const withBreaks = flattened
    // `</li>` is deliberately absent: `<li>` already opens its own line.
    .replace(/<\/(p|div|section|article|tr|h[1-6]|blockquote|td|th)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ");

  return decodeEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Keep only the parts of a snapshot covering the named sections.
 *
 * Statute pages run to megabytes and git history is forever, so a sectional
 * snapshot stores the provisions actually cited. Matching is loose on purpose —
 * it is a size reduction, not a parser — and a section that cannot be located
 * is reported so a human notices rather than silently losing coverage.
 */
export function extractSections(
  text: string,
  sections: readonly string[],
): { text: string; missing: string[] } {
  const lines = text.split("\n");
  const missing: string[] = [];
  const kept: string[] = [];

  for (const section of sections) {
    const needle = section.toLowerCase().replace(/^s\.\s*/, "");
    const start = lines.findIndex((line) => {
      const normalized = line.toLowerCase().trim();
      return (
        normalized.startsWith(`${needle}.`) ||
        normalized.startsWith(`${needle} `) ||
        normalized.startsWith(section.toLowerCase())
      );
    });
    if (start === -1) {
      missing.push(section);
      continue;
    }
    kept.push(`### ${section}`, ...lines.slice(start, start + 40), "");
  }

  return { text: kept.join("\n").trim(), missing };
}
