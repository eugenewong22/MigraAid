import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SiteHeader } from "@/components/SiteHeader";

/**
 * Localized 404: rendered by Next for any unmatched route nested under
 * `[locale]` (e.g. /en/typo), so the worker always sees the Daybreak page
 * chrome and their own language rather than an unstyled English default.
 *
 * NOTE: Next does NOT pass `params` to `not-found.tsx` (it renders outside the
 * normal segment-props flow), so the locale is read from the ambient request
 * context — established by the `[locale]` layout — via `getLocale()`. Reading
 * `params` here throws "Cannot destructure 'locale' of undefined". An
 * unsupported locale segment is already resolved to the default by the i18n
 * request config, so no extra validation is needed here.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "notFound" });
  return { title: t("title") };
}

export default async function NotFound() {
  const locale = await getLocale();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "notFound" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  return (
    <main className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 py-16 text-center md:px-12 md:py-24">
        <h1 className="font-display font-[650] text-ink text-[28px] leading-[1.3] md:text-[36px]">
          {t("title")}
        </h1>
        <p className="max-w-[440px] text-body-soft text-[16px] leading-[1.55] md:text-[17px]">
          {t("body")}
        </p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:gap-3.5">
          <Link
            href="/"
            className="inline-flex min-h-[52px] items-center justify-center rounded-full bg-terracotta px-8 text-[16px] font-bold text-[#fff7ec] transition-colors hover:bg-terracotta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            {t("home")}
          </Link>
          <Link
            href="/emergency"
            className="inline-flex min-h-[52px] items-center justify-center rounded-full border-2 border-emergency px-8 text-[16px] font-[600] text-emergency transition-colors hover:bg-emergency/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emergency focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            {tNav("emergency")}
          </Link>
        </div>
      </div>
    </main>
  );
}
