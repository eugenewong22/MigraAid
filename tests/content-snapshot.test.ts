import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  digestBytes,
  extractSections,
  htmlToText,
  snapshotPathFor,
} from "@/lib/content/snapshot";

describe("digestBytes", () => {
  it("digests the raw bytes, not a decoded string", () => {
    const bytes = new TextEncoder().encode("hello");
    expect(digestBytes(bytes)).toBe(
      createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
    );
  });

  it("distinguishes byte sequences that decode alike", () => {
    expect(digestBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).not.toBe(
      digestBytes(new Uint8Array([0x61])),
    );
  });
});

describe("snapshotPathFor", () => {
  it("files a snapshot under its source and read date", () => {
    expect(snapshotPathFor("sg-employment-act-1968", "2026-07-26")).toBe(
      "content/_snapshots/sg-employment-act-1968/2026-07-26.txt",
    );
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("a &amp; b &#39;c&#39; &#x2014; d &nbsp;e")).toBe(
      "a & b 'c' — d  e",
    );
  });

  it("leaves an unknown entity alone rather than mangling it", () => {
    expect(decodeEntities("&notanentity; &#xZZ;")).toBe("&notanentity; &#xZZ;");
  });
});

describe("htmlToText", () => {
  it("drops scripts, styles and comments entirely", () => {
    const html =
      "<p>Keep</p><script>var secret = 1;</script><style>.a{}</style><!-- note -->";
    const text = htmlToText(html);
    expect(text).toContain("Keep");
    expect(text).not.toContain("secret");
    expect(text).not.toContain(".a{}");
    expect(text).not.toContain("note");
  });

  it("turns block boundaries into newlines and list items into bullets", () => {
    const text = htmlToText("<p>One</p><p>Two</p><ul><li>A</li><li>B</li></ul>");
    expect(text.split("\n").filter(Boolean)).toEqual(["One", "Two", "- A", "- B"]);
  });

  it("never emits more than one blank line in a row", () => {
    const text = htmlToText("<p>One</p><div></div><div></div><div></div><p>Two</p>");
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("collapses whitespace so a reflow does not read as a content change", () => {
    const a = htmlToText("<p>An   employer\n\n  shall    pay</p>");
    const b = htmlToText("<p>An employer shall pay</p>");
    expect(a).toBe(b);
  });

  it("decodes entities in the extracted text", () => {
    expect(htmlToText("<p>7 days &amp; 14 days</p>")).toBe("7 days & 14 days");
  });
});

describe("extractSections", () => {
  const statute = [
    "Employment Act 1968",
    "20A. Definitions in this Part.",
    "Some definition text.",
    "21. Salary to be paid within 7 days.",
    "An employer shall pay each employee.",
    "22. Payment on dismissal.",
    "More text.",
  ].join("\n");

  it("keeps the named sections and labels each one", () => {
    const { text, missing } = extractSections(statute, ["s.21"]);
    expect(missing).toEqual([]);
    expect(text).toContain("### s.21");
    expect(text).toContain("An employer shall pay each employee.");
  });

  it("reports a section it cannot locate instead of silently dropping it", () => {
    const { missing } = extractSections(statute, ["s.21", "s.99"]);
    expect(missing).toEqual(["s.99"]);
  });

  it("matches a schedule named without the s. prefix", () => {
    const { missing } = extractSections("Fourth Schedule\nText here", [
      "Fourth Schedule",
    ]);
    expect(missing).toEqual([]);
  });
});
