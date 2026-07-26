/**
 * A deliberately small frontmatter parser for the knowledge corpus.
 *
 * The corpus uses flat `key: value` metadata only, so this stays a line parser
 * rather than pulling in a YAML dependency — multi-line values live in the body
 * behind the source-excerpt delimiter instead (see `excerpt.ts`).
 *
 * It is stricter than a naive splitter in three ways that matter for citations:
 * quoted values are unquoted (otherwise `source_ref: "Employment Act 1968, s.
 * 21"` renders to workers *with* the quotes), comment lines are ignored, and a
 * duplicate key throws rather than silently letting the last one win.
 */

const DOCUMENT = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export interface ParsedDocument {
  meta: Record<string, string>;
  body: string;
}

/** Remove one matched pair of surrounding single or double quotes. */
function unquote(value: string): string {
  const match = value.match(/^(["'])([\s\S]*)\1$/);
  return match ? match[2] : value;
}

export function parseFrontmatter(raw: string): ParsedDocument {
  const match = raw.match(DOCUMENT);
  if (!match) return { meta: {}, body: raw.trim() };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const idx = line.indexOf(":");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    if (key in meta) {
      throw new Error(`duplicate frontmatter key "${key}"`);
    }
    meta[key] = unquote(line.slice(idx + 1).trim());
  }

  return { meta, body: match[2].trim() };
}
