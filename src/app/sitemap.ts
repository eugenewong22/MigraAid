import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";

/**
 * Canonical origin, duplicated from `[locale]/layout.tsx`'s `SITE_URL`
 * rather than imported from it: that file also declares the `next/font`
 * webfonts, which only resolve under Next's compiler — importing it here
 * would drag font-loader side effects into this route (and break plain
 * unit tests, e.g. `tests/metadata.test.ts`). Keep both in sync if the
 * production origin ever changes.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://migraaid.sg";

/** The public (crawlable) route pathnames, locale prefix excluded. */
const PUBLIC_PATHNAMES = [
  "",
  "/chat",
  "/contract",
  "/emergency",
  "/privacy",
  "/terms",
] as const;

/** Builds the hreflang alternates (all locales + x-default) for one route. */
function languageAlternates(pathname: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of routing.locales) {
    languages[locale] = `${SITE_URL}/${locale}${pathname}`;
  }
  languages["x-default"] = `${SITE_URL}/${routing.defaultLocale}${pathname}`;
  return languages;
}

/**
 * Sitemap covering every public, crawlable route across all locales
 * (8 locales × 4 routes = 32 URLs). Admin and API routes are intentionally
 * excluded — they're private and already send a noindex response header.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    for (const pathname of PUBLIC_PATHNAMES) {
      entries.push({
        url: `${SITE_URL}/${locale}${pathname}`,
        lastModified,
        changeFrequency: pathname === "" ? "weekly" : "monthly",
        priority: pathname === "" ? 1 : 0.7,
        alternates: { languages: languageAlternates(pathname) },
      });
    }
  }

  return entries;
}
