/**
 * Whole-corpus invariants.
 *
 * These run on every pull request with no database and no model calls, so a
 * change to `content/` is checked before it can reach anyone. They are the
 * standing replacement for the human review gate that publication no longer
 * requires: a person still edits each item, but these hold the line mechanically.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "@/lib/content/frontmatter";
import { splitSourceExcerpt, unquoteExcerpt } from "@/lib/content/excerpt";
import { verifyContentFrontmatter } from "@/lib/content/verification";
import { chunkMarkdown } from "@/lib/rag/chunk";
import { SOURCE_DOMAINS, getSource } from "@/lib/content/sources";
import { anchorOccursIn, styleViolations, unsupportedNumbers } from "@/lib/content/fidelity";

interface CorpusItem {
  name: string;
  domain: string;
  meta: Record<string, string>;
  bodyMd: string;
  excerpt: string | null;
}

const CONTENT_DIR = path.join(process.cwd(), "content");

const corpus: CorpusItem[] = SOURCE_DOMAINS.flatMap((domain) => {
  let names: string[];
  try {
    names = readdirSync(path.join(CONTENT_DIR, domain)).filter((f) =>
      f.endsWith(".md"),
    );
  } catch {
    return [];
  }
  return names.map((name) => {
    const raw = readFileSync(path.join(CONTENT_DIR, domain, name), "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const split = splitSourceExcerpt(body);
    return {
      name: `${domain}/${name}`,
      domain,
      meta,
      bodyMd: split.bodyMd,
      excerpt: split.sourceExcerpt,
    };
  });
});

/** Snapshot text for an item's source, with the provenance header removed. */
function snapshotFor(item: CorpusItem): string | null {
  const source = getSource(item.meta.source_id);
  if (!source?.snapshotPath || !existsSync(source.snapshotPath)) return null;
  return readFileSync(source.snapshotPath, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("# "))
    .join("\n");
}

describe("the corpus", () => {
  it("has items to check", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  it.each(corpus.map((item) => [item.name, item] as const))(
    "%s is well-formed",
    (_name, item) => {
      expect(item.meta.title?.length ?? 0).toBeGreaterThan(5);
      expect(["draft", "published"]).toContain(item.meta.status);
      expect(item.meta.source_id, "every item names a registry source").toBeTruthy();
      expect(getSource(item.meta.source_id), "source_id resolves").toBeDefined();
      expect(item.meta.source_ref?.length ?? 0).toBeGreaterThan(3);
      // Quotes in frontmatter would render into the citation label shown to workers.
      expect(item.meta.source_ref).not.toMatch(/^["']|["']$/);
    },
  );

  it.each(corpus.map((item) => [item.name, item] as const))(
    "%s is sized to a single retrieval chunk",
    (_name, item) => {
      // One topic, one item, one chunk: keeps top-k precision as the corpus
      // grows, and makes a citation exactly as granular as the guidance.
      expect(item.bodyMd.length).toBeGreaterThan(120);
      expect(item.bodyMd.length).toBeLessThanOrEqual(1_200);
      expect(chunkMarkdown(item.bodyMd)).toHaveLength(1);
    },
  );

  it.each(corpus.map((item) => [item.name, item] as const))(
    "%s declares a domain matching its directory",
    (_name, item) => {
      const source = getSource(item.meta.source_id);
      expect(
        source?.domains,
        `${item.name}: source "${item.meta.source_id}" does not cover ${item.domain}`,
      ).toContain(item.domain);
    },
  );

  it.each(corpus.map((item) => [item.name, item] as const))(
    "%s uses information language, not advice language",
    (_name, item) => {
      expect(styleViolations(item.bodyMd)).toEqual([]);
    },
  );

  it("publishes only what the frontmatter gate accepts", () => {
    for (const item of corpus) {
      if (item.meta.status !== "published") continue;
      const verification = verifyContentFrontmatter(item.meta);
      expect(verification.reasons, `${item.name}`).toEqual([]);
    }
  });
});

const anchored = corpus.filter((item) => item.excerpt);

describe("anchor fidelity", () => {
  it("has anchored items to check", () => {
    expect(anchored.length).toBeGreaterThan(0);
  });

  it.each(anchored.map((item) => [item.name, item] as const))(
    "%s quotes its source verbatim",
    (_name, item) => {
      const snapshot = snapshotFor(item);
      if (!snapshot) return; // statutes are snapshotted by hand; nothing to compare
      expect(
        anchorOccursIn(snapshot, unquoteExcerpt(item.excerpt!)),
        `${item.name}: the anchor is not a verbatim passage of its source snapshot`,
      ).toBe(true);
    },
  );

  it.each(anchored.map((item) => [item.name, item] as const))(
    "%s asserts no number its source does not support",
    (_name, item) => {
      // The highest-harm error mode: a deadline or threshold that is not the
      // one the law states.
      expect(
        unsupportedNumbers(item.bodyMd, unquoteExcerpt(item.excerpt!)),
        `${item.name}: numbers not found in the source passage`,
      ).toEqual([]);
    },
  );
});
