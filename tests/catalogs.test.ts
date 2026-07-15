import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";

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
