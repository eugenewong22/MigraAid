import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

describe("sitemap", () => {
  it("enumerates every locale x public route (8 x 4)", () => {
    const entries = sitemap();
    expect(entries).toHaveLength(routing.locales.length * 4);
  });

  it("never includes admin or api routes", () => {
    const entries = sitemap();
    for (const entry of entries) {
      expect(entry.url).not.toMatch(/\/admin(\/|$)/);
      expect(entry.url).not.toMatch(/\/api(\/|$)/);
    }
  });

  it("covers all 8 locales plus x-default in each entry's alternates", () => {
    const entries = sitemap();
    for (const entry of entries) {
      const languages = entry.alternates?.languages;
      expect(languages).toBeDefined();
      for (const locale of routing.locales) {
        expect(languages).toHaveProperty(locale);
      }
      expect(languages).toHaveProperty("x-default");
    }
  });
});

describe("robots", () => {
  it("disallows admin and api routes, and points at the sitemap", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const disallowed = rules.flatMap((rule) =>
      rule?.disallow
        ? Array.isArray(rule.disallow)
          ? rule.disallow
          : [rule.disallow]
        : [],
    );
    expect(disallowed).toEqual(
      expect.arrayContaining(["/admin", "/*/admin", "/api"]),
    );
    expect(result.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
