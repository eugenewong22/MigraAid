import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";
import { safetyResponse } from "@/lib/safety/responses";

const messagesDirectory = resolve(process.cwd(), "messages");
const localeFiles = readdirSync(messagesDirectory)
  .filter((file) => file.endsWith(".json"))
  .sort();

function loadCatalog(file: string): unknown {
  return JSON.parse(readFileSync(resolve(messagesDirectory, file), "utf8"));
}

function flattenStrings(
  value: unknown,
  path: string[] = [],
): Array<[key: string, value: string]> {
  if (typeof value === "string") return [[path.join("."), value]];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      'Translation at "' + path.join(".") + '" must be a string',
    );
  }

  return Object.entries(value).flatMap(([key, child]) =>
    flattenStrings(child, [...path, key]),
  );
}

const englishEntries = flattenStrings(loadCatalog("en.json"));
const englishKeys = englishEntries.map(([key]) => key).sort();

describe("translation catalogs", () => {
  it("has one catalog for every routed locale", () => {
    expect(localeFiles.map((file) => file.replace(/\.json$/, ""))).toEqual(
      [...routing.locales].sort(),
    );
  });

  it.each(localeFiles)("%s has every English key and no empty values", (file) => {
    const entries = flattenStrings(loadCatalog(file));

    expect(entries.map(([key]) => key).sort()).toEqual(englishKeys);
    expect(entries.every(([, value]) => value.trim().length > 0)).toBe(true);
  });
});

describe("crisis copy is under catalog parity", () => {
  it("exposes all three safety strings for every routed locale", () => {
    // These are the highest-stakes strings in the product: the crisis referral,
    // the ungrounded refusal, and the injection reply. They lived as inline
    // maps in answer.ts, which meant the one part of the UI that could not
    // afford to drift was the one part this test did not cover.
    for (const locale of routing.locales) {
      for (const kind of ["ungrounded", "highStakes", "injection"] as const) {
        const text = safetyResponse(locale, kind);
        expect(text, `${locale}.${kind}`).toBeTruthy();
        expect(text.length, `${locale}.${kind}`).toBeGreaterThan(20);
      }
    }
  });

  it("falls back to English rather than rendering nothing", () => {
    expect(safetyResponse("xx", "highStakes")).toBe(
      safetyResponse("en", "highStakes"),
    );
  });
});
