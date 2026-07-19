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

// Per-request CSP nonces cannot be applied to build-time static HTML.
export const dynamic = "force-dynamic";

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
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "home",
  });
  return {
    title: { default: "MigraAid", template: "%s — MigraAid" },
    description: t("metaDescription"),
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
