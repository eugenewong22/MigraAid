import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  containsExcerptDelimiter,
  splitSourceExcerpt,
  unquoteExcerpt,
} from "@/lib/content/excerpt";
import { parseFrontmatter } from "@/lib/content/frontmatter";
import { chunkMarkdown } from "@/lib/rag/chunk";
import { SOURCE_DOMAINS } from "@/lib/content/sources";

/** Compare on content, not on our line wrapping. */
function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const BODY = "Your employer must pay your salary within 7 days.";
const EXCERPT = "> An employer shall pay to each employee not later than seven days.";

describe("splitSourceExcerpt", () => {
  it("treats a file with no delimiter as paraphrase-only", () => {
    expect(splitSourceExcerpt(`  ${BODY}  `)).toEqual({
      bodyMd: BODY,
      sourceExcerpt: null,
    });
  });

  it("splits a body and excerpt on the delimiter", () => {
    expect(
      splitSourceExcerpt(`${BODY}\n\n<!-- source-excerpt -->\n\n${EXCERPT}\n`),
    ).toEqual({ bodyMd: BODY, sourceExcerpt: EXCERPT });
  });

  it("accepts the delimiter without inner spaces", () => {
    expect(
      splitSourceExcerpt(`${BODY}\n<!--source-excerpt-->\n${EXCERPT}`),
    ).toEqual({ bodyMd: BODY, sourceExcerpt: EXCERPT });
  });

  it.each([
    [
      "more than one delimiter",
      `${BODY}\n<!-- source-excerpt -->\n${EXCERPT}\n<!-- source-excerpt -->\nmore`,
      /found 2/,
    ],
    ["an empty file", "   \n  ", /content body is empty/],
    [
      "an empty body before the delimiter",
      `<!-- source-excerpt -->\n${EXCERPT}`,
      /body is empty before/,
    ],
    [
      "a delimiter with nothing after it",
      `${BODY}\n<!-- source-excerpt -->\n   `,
      /excerpt is empty/,
    ],
  ])("refuses %s", (_label, raw, pattern) => {
    expect(() => splitSourceExcerpt(raw)).toThrow(pattern);
  });
});

describe("unquoteExcerpt", () => {
  it("strips the blockquote punctuation we added, not the source's text", () => {
    expect(unquoteExcerpt("> line one\n> line two")).toBe("line one\nline two");
  });

  it("leaves an unquoted excerpt untouched", () => {
    expect(unquoteExcerpt("line one\nline two")).toBe("line one\nline two");
  });
});

/** Every corpus file, already split. */
function corpusFiles() {
  const contentDir = path.join(process.cwd(), "content");
  const files: Array<{ name: string; bodyMd: string; excerpt: string | null }> = [];
  for (const domain of SOURCE_DOMAINS) {
    let names: string[];
    try {
      names = readdirSync(path.join(contentDir, domain)).filter((f) =>
        f.endsWith(".md"),
      );
    } catch {
      continue;
    }
    for (const name of names) {
      const raw = readFileSync(path.join(contentDir, domain, name), "utf8");
      const { body } = parseFrontmatter(raw);
      const split = splitSourceExcerpt(body);
      files.push({
        name: `${domain}/${name}`,
        bodyMd: split.bodyMd,
        excerpt: split.sourceExcerpt,
      });
    }
  }
  return files;
}

describe("the verbatim anchor is never retrievable", () => {
  it("excludes the excerpt from what the chunker sees", () => {
    // Non-vacuous guard for the corpus sweep below, which only has teeth once
    // corpus files actually carry anchors.
    const raw = `${BODY}\n\n<!-- source-excerpt -->\n\n${EXCERPT}`;
    const { bodyMd, sourceExcerpt } = splitSourceExcerpt(raw);
    const chunked = chunkMarkdown(bodyMd).join("\n");

    expect(sourceExcerpt).toBeTruthy();
    expect(chunked).toContain("within 7 days");
    expect(chunked).not.toContain("not later than seven days");
    // And the naive alternative — chunking the whole file — would have leaked it.
    expect(chunkMarkdown(raw).join("\n")).toContain("not later than seven days");
  });

  it("keeps every corpus excerpt out of the chunks that get embedded", () => {
    // The failure this guards against is a split that did not happen, which
    // puts the *whole* excerpt into the body. A shared sentence is not a leak:
    // a good paraphrase of a plainly-worded source often reuses its words.
    for (const file of corpusFiles()) {
      if (!file.excerpt) continue;
      const chunked = normalize(chunkMarkdown(file.bodyMd).join("\n"));
      const anchor = normalize(unquoteExcerpt(file.excerpt));
      expect(
        chunked.includes(anchor),
        `${file.name}: the excerpt block leaked into an embedded chunk`,
      ).toBe(false);
    }
  });

  it("every corpus file splits without error", () => {
    expect(() => corpusFiles()).not.toThrow();
  });
});

describe("containsExcerptDelimiter", () => {
  it("is stable across repeated calls", () => {
    // The exported regex is global, so a naive `.test()` would alternate.
    const text = "body\n<!-- source-excerpt -->\nquote";
    expect(containsExcerptDelimiter(text)).toBe(true);
    expect(containsExcerptDelimiter(text)).toBe(true);
    expect(containsExcerptDelimiter(text)).toBe(true);
  });

  it("is false for text with no delimiter", () => {
    expect(containsExcerptDelimiter("just a body")).toBe(false);
  });
});
