import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Noto_Sans_Bengali,
  Noto_Sans_Myanmar,
  Noto_Sans_Tamil,
  Spline_Sans,
} from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { SiteFooter } from "@/components/SiteFooter";
import "../globals.css";

/**
 * Type, per script.
 *
 * Bricolage Grotesque and Spline Sans are Latin-only. Shipping them to every
 * locale sent ~188KB of glyphs a Bengali, Tamil or Burmese reader can never
 * use, and left their own script to whatever the device happens to have
 * installed — which on a cheap Android is often nothing, so the page renders as
 * tofu boxes. That is a total failure, not a degradation.
 *
 * `next/font` exposes a family through a CSS variable applied via `className`,
 * so *not applying the class* means the file is never requested. Conditional
 * application is therefore all that is needed.
 *
 * Thai and Chinese are left to system fonts: coverage is near-universal on
 * Android, and Noto Sans SC in particular is enormous.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const splineSans = Spline_Sans({
  subsets: ["latin"],
  variable: "--font-spline",
  display: "swap",
});

const notoBengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  variable: "--font-script",
  display: "swap",
  preload: false,
});

const notoTamil = Noto_Sans_Tamil({
  subsets: ["tamil"],
  variable: "--font-script",
  display: "swap",
  preload: false,
});

/**
 * Burmese matters most of the three. Noto Sans Myanmar is frequently absent on
 * low-end Android, and the Zawgyi/Unicode split means text can render as
 * garbage even when *a* Burmese font is installed — self-hosting a Unicode font
 * fixes both.
 */
const notoMyanmar = Noto_Sans_Myanmar({
  subsets: ["myanmar"],
  weight: ["400", "700"],
  variable: "--font-script",
  display: "swap",
  preload: false,
});

const LATIN_LOCALES = new Set(["en", "tl", "id"]);

/** Font variables for a locale — only the ones its script actually needs. */
function fontVariables(locale: string): string {
  if (LATIN_LOCALES.has(locale)) {
    return `${bricolage.variable} ${splineSans.variable}`;
  }
  if (locale === "bn") return notoBengali.variable;
  if (locale === "ta") return notoTamil.variable;
  if (locale === "my") return notoMyanmar.variable;
  // th, zh — system fonts via the stack in globals.css.
  return "";
}

// Per-request CSP nonces cannot be applied to build-time static HTML, so this
// route tree can't be statically rendered. That also means metadata (this
// file's generateMetadata + every page's) is recomputed per request rather
// than baked in at build time — an accepted trade-off for the nonce-based CSP.
export const dynamic = "force-dynamic";

/**
 * Canonical origin for absolute URLs (metadataBase, sitemap, robots).
 * Override via NEXT_PUBLIC_SITE_URL in deployments that use a different host.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://migraaid.sg";

/**
 * Builds `alternates.languages` + `alternates.canonical` for a localized
 * page. `pathname` is the un-prefixed route, e.g. "" for home, "/chat" for
 * the chat page. Derived from `routing.locales` so every new locale is
 * automatically covered without touching each page's metadata.
 */
export function buildAlternates(
  locale: string,
  pathname: string,
): Metadata["alternates"] {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    languages[l] = `/${l}${pathname}`;
  }
  languages["x-default"] = `/${routing.defaultLocale}${pathname}`;
  return {
    canonical: `/${locale}${pathname}`,
    languages,
  };
}

/** Builds a locale-aware `openGraph` block from a page's title/description. */
export function buildOpenGraph(
  locale: string,
  title: string,
  description: string,
): Metadata["openGraph"] {
  return {
    title,
    description,
    locale,
    alternateLocale: routing.locales.filter((l) => l !== locale),
    type: "website",
  };
}

/**
 * Localized metadata: the tab title/description must be in the worker's
 * language (Bengali/Tamil/… tabs previously carried English metadata).
 * Inner pages extend the title via their own generateMetadata.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const activeLocale = hasLocale(routing.locales, locale)
    ? locale
    : routing.defaultLocale;
  const t = await getTranslations({ locale: activeLocale, namespace: "home" });
  const description = t("metaDescription");
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: "MigraAid", template: "%s — MigraAid" },
    description,
    openGraph: buildOpenGraph(activeLocale, "MigraAid", description),
  };
}

/** Pre-render all supported locales at build time. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "nav" });

  return (
    <html
      lang={locale}
      className={`h-full antialiased ${fontVariables(locale)}`}
    >
      <body className="min-h-full flex flex-col">
        {/* First focusable element on every page: a keyboard user should not
            have to traverse the wordmark, three nav links and the language
            picker to reach the composer, on every single page load. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-cream focus:px-4 focus:py-3 focus:font-semibold focus:text-ink focus:outline focus:outline-2 focus:outline-offset-2"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
          {children}
          <SiteFooter />
        </NextIntlClientProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
