import type { Metadata } from "next";
import { Bricolage_Grotesque, Spline_Sans } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "../globals.css";

// Daybreak type: Bricolage Grotesque for display, Spline Sans for body/UI.
// Both are Latin-only — non-Latin locales fall back to the Noto stack declared
// in globals.css. `swap` keeps text visible while the webfonts load.
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

  return (
    <html
      lang={locale}
      className={`h-full antialiased ${bricolage.variable} ${splineSans.variable}`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
