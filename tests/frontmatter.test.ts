import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "@/lib/content/frontmatter";

describe("parseFrontmatter", () => {
  it("parses flat key/value metadata and the body", () => {
    expect(
      parseFrontmatter("---\ntitle: Salary\nstatus: published\n---\nBody text\n"),
    ).toEqual({
      meta: { title: "Salary", status: "published" },
      body: "Body text",
    });
  });

  it("treats a document with no frontmatter as all body", () => {
    expect(parseFrontmatter("  Just a body  ")).toEqual({
      meta: {},
      body: "Just a body",
    });
  });

  it("strips surrounding quotes so citations do not render with them", () => {
    // The naive parser stored the quotes literally, and source_ref is what the
    // assistant shows workers as the citation label.
    const { meta } = parseFrontmatter(
      `---\nsource_ref: "Employment Act 1968, s. 21(1)"\ntitle: 'Salary'\n---\nBody\n`,
    );
    expect(meta.source_ref).toBe("Employment Act 1968, s. 21(1)");
    expect(meta.title).toBe("Salary");
  });

  it("leaves unmatched or inner quotes alone", () => {
    const { meta } = parseFrontmatter(
      `---\na: "unterminated\nb: say "hi" there\n---\nBody\n`,
    );
    expect(meta.a).toBe('"unterminated');
    expect(meta.b).toBe('say "hi" there');
  });

  it("ignores comment and blank lines", () => {
    const { meta } = parseFrontmatter(
      "---\n# a comment\n\ntitle: Salary\n---\nBody\n",
    );
    expect(meta).toEqual({ title: "Salary" });
  });

  it("keeps colons inside a value", () => {
    const { meta } = parseFrontmatter(
      "---\nsource_url: https://sso.agc.gov.sg/Act/EmA1968\n---\nBody\n",
    );
    expect(meta.source_url).toBe("https://sso.agc.gov.sg/Act/EmA1968");
  });

  it("refuses a duplicate key rather than silently taking the last one", () => {
    expect(() =>
      parseFrontmatter("---\ntitle: One\ntitle: Two\n---\nBody\n"),
    ).toThrow(/duplicate frontmatter key "title"/);
  });
});
