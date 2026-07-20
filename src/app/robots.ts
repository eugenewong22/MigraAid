import type { MetadataRoute } from "next";

/**
 * Canonical origin, duplicated from `[locale]/layout.tsx`'s `SITE_URL`
 * rather than imported from it: that file also declares the `next/font`
 * webfonts, which only resolve under Next's compiler — importing it here
 * would drag font-loader side effects into this route (and break plain
 * unit tests, e.g. `tests/metadata.test.ts`). Keep both in sync if the
 * production origin ever changes.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://migraaid.sg";

/**
 * robots.txt: allows crawling of the public worker-facing routes, and
 * disallows the admin console and API surface. Admin responses already carry
 * an `X-Robots-Tag: noindex` header (see next.config.ts) — this is a
 * belt-and-suspenders signal for crawlers that don't fetch response headers.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/*/admin", "/api"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
