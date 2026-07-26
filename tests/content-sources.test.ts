import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SOURCE_DOMAINS,
  loadSourceRegistry,
  getSource,
  parseSourceRegistry,
  staleSources,
  type SourceEntry,
} from "@/lib/content/sources";
import { parseCalendarDate, parsePastCalendarDate } from "@/lib/content/dates";

const registry = loadSourceRegistry();
const NOW = new Date("2026-07-26T00:00:00.000Z");

/** Every `source_id:` referenced by a corpus file. */
function referencedSourceIds(): Array<{ file: string; sourceId: string }> {
  const contentDir = path.join(process.cwd(), "content");
  const refs: Array<{ file: string; sourceId: string }> = [];
  for (const domain of SOURCE_DOMAINS) {
    const dir = path.join(contentDir, domain);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const file of files) {
      const raw = readFileSync(path.join(dir, file), "utf8");
      const match = raw.match(/^source_id:\s*(.+)$/m);
      if (match) {
        refs.push({ file: `${domain}/${file}`, sourceId: match[1].trim() });
      }
    }
  }
  return refs;
}

describe("content/sources.json", () => {
  it("parses against the registry schema", () => {
    expect(registry.length).toBeGreaterThan(0);
  });

  it("has unique ids", () => {
    const ids = registry.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every knowledge domain", () => {
    const covered = new Set(registry.flatMap((entry) => entry.domains));
    expect([...SOURCE_DOMAINS].filter((d) => !covered.has(d))).toEqual([]);
  });

  it("records a non-future retrieval date when it records one at all", () => {
    for (const entry of registry) {
      if (entry.retrievedAt) {
        expect(
          parsePastCalendarDate(entry.retrievedAt, NOW),
          `${entry.id} retrievedAt`,
        ).not.toBeNull();
      }
    }
  });

  it("requires a robots.txt check before any host may be fetched automatically", () => {
    for (const entry of registry) {
      if (entry.fetchPolicy === "automated") {
        expect(entry.robotsCheckedAt, `${entry.id}`).toBeDefined();
      }
    }
  });

  it("pairs every snapshot with its digest", () => {
    for (const entry of registry) {
      expect(
        Boolean(entry.snapshotPath),
        `${entry.id} snapshotPath/snapshotSha256`,
      ).toBe(Boolean(entry.snapshotSha256));
    }
  });

  it("names the sections it snapshots when the scope is sectional", () => {
    for (const entry of registry) {
      if (entry.snapshotScope === "sections") {
        expect(entry.sections?.length, `${entry.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("records a licence verification that is complete, or none at all", () => {
    for (const entry of registry) {
      const { verifiedBy, verifiedAt } = entry.licence;
      expect(
        Boolean(verifiedBy),
        `${entry.id}: verifiedBy and verifiedAt must be set together`,
      ).toBe(Boolean(verifiedAt));
      if (verifiedAt) {
        expect(parsePastCalendarDate(verifiedAt, NOW), `${entry.id}`).not.toBeNull();
      }
    }
  });

  it("resolves every source_id referenced by the corpus", () => {
    for (const { file, sourceId } of referencedSourceIds()) {
      expect(getSource(sourceId), `${file} references "${sourceId}"`).toBeDefined();
    }
  });
});

describe("parseSourceRegistry", () => {
  const VALID: Record<string, unknown> = {
    id: "example-source",
    title: "Example",
    issuingAuthority: "Someone",
    citationLabel: "Example — thing",
    tier: "statute",
    domains: ["legal_rights"],
    canonicalUrl: "https://example.org/doc",
    licence: {
      id: "example-licence",
      name: "Example Licence",
      url: "https://example.org/licence",
      note: "Unverified.",
    },
  };

  function withEntry(overrides: Record<string, unknown>): string {
    return JSON.stringify([{ ...VALID, ...overrides }]);
  }

  it("accepts a minimal valid entry and defaults fetchPolicy to manual", () => {
    const [entry] = parseSourceRegistry(JSON.stringify([VALID]));
    expect(entry.fetchPolicy).toBe("manual");
    expect(entry.snapshotScope).toBe("full");
  });

  it.each([
    ["a non-slug id", { id: "Not A Slug" }],
    ["a non-HTTPS canonical URL", { canonicalUrl: "http://example.org/doc" }],
    ["a URL with credentials", { canonicalUrl: "https://u:p@example.org/doc" }],
    ["an unknown tier", { tier: "blog_post" }],
    ["an unknown domain", { domains: ["migraine"] }],
    ["no domains", { domains: [] }],
    ["placeholder text", { issuingAuthority: "TBD" }],
    ["automated fetching with no robots check", { fetchPolicy: "automated" }],
    ["a snapshot with no digest", { snapshotPath: "content/_snapshots/x.txt" }],
    ["sectional scope with no sections", { snapshotScope: "sections" }],
    ["an impossible verification date", {
      licence: {
        id: "l",
        name: "L",
        url: "https://example.org/l",
        note: "n",
        verifiedBy: "Someone",
        verifiedAt: "2026-02-30",
      },
    }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => parseSourceRegistry(withEntry(overrides))).toThrow(
      /content\/sources\.json is invalid/,
    );
  });

  it("rejects duplicate ids", () => {
    expect(() => parseSourceRegistry(JSON.stringify([VALID, VALID]))).toThrow(
      /duplicate source id/,
    );
  });
});

describe("staleSources", () => {
  const entry = (recheckAfter?: string) =>
    ({ id: "x", recheckAfter }) as SourceEntry;

  it("reports entries whose recheck date has passed", () => {
    expect(staleSources(NOW, [entry("2026-01-01")])).toHaveLength(1);
  });

  it("ignores future and absent recheck dates", () => {
    expect(staleSources(NOW, [entry("2027-01-01"), entry()])).toHaveLength(0);
  });
});

describe("calendar dates", () => {
  it.each(["2026-02-30", "2026-13-01", "26-07-14", "14 July 2026", ""])(
    "rejects %s",
    (value) => {
      expect(parseCalendarDate(value)).toBeNull();
    },
  );

  it("accepts a real date", () => {
    expect(parseCalendarDate("2026-07-14")).toEqual(
      new Date("2026-07-14T00:00:00.000Z"),
    );
  });

  it("rejects a future date only via parsePastCalendarDate", () => {
    expect(parseCalendarDate("2027-01-01")).not.toBeNull();
    expect(parsePastCalendarDate("2027-01-01", NOW)).toBeNull();
  });
});
