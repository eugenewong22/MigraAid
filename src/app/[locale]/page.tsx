import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { DeleteMyData } from "@/components/DeleteMyData";
import { buildAlternates, buildOpenGraph } from "./layout";

/** Canonical/hreflang alternates for the home route ("/"). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
  const description = t("metaDescription");
  return {
    alternates: buildAlternates(locale, ""),
    openGraph: buildOpenGraph(locale, "MigraAid", description),
  };
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <main className="flex-1">
      {/* Programmatic page title; the visible headline is the tagline below. */}
      <h1 className="sr-only">{t("title")}</h1>

      <SiteHeader />

      {/* Hero — cream with decorative sunrise circles behind the content. */}
      <section className="relative overflow-hidden px-5 py-8 md:px-12 md:pb-20 md:pt-[72px]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-[90px] right-[-70px] h-[230px] w-[230px] rounded-full bg-[#f3d9a4] opacity-25 md:-top-[180px] md:right-[-110px] md:h-[430px] md:w-[430px] md:opacity-55"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-[140px] right-[60px] h-[180px] w-[180px] rounded-full bg-[#e8b48f] opacity-35 md:-bottom-[230px] md:right-[180px] md:h-[330px] md:w-[330px] md:opacity-40"
        />
        <div className="relative flex max-w-[760px] flex-col gap-4 md:gap-6">
          <span className="font-bold uppercase leading-none tracking-[0.12em] text-terracotta text-[12.5px] md:text-[14px]">
            {t("eyebrow")}
          </span>
          <h2 className="font-display font-[650] tracking-[-0.01em] text-ink text-[34px] leading-[1.1] md:text-[58px] md:leading-[1.06] md:tracking-[-0.015em]">
            {t("tagline")}
          </h2>
          <p className="max-w-[580px] text-body-soft text-[16.5px] leading-[1.55] md:text-[19.5px] md:leading-[1.6]">
            {t("heroLede")}
          </p>
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:gap-3.5 md:mt-1.5">
            <Link
              href="/chat"
              className="inline-flex min-h-[54px] items-center justify-center rounded-full bg-terracotta px-8 text-[17px] font-bold text-[#fff7ec] transition-colors hover:bg-terracotta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
            >
              {t("startChat")}
            </Link>
            <Link
              href="/contract"
              className="inline-flex min-h-[54px] items-center justify-center rounded-full border-2 border-terracotta px-8 text-[17px] font-[600] text-terracotta transition-colors hover:bg-terracotta/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
            >
              {t("contractCta")}
            </Link>
          </div>
        </div>
      </section>

      {/* Three info cards. Stacked (circle-left-of-text) on mobile, 3-col grid
          on desktop; the danger card uses the emergency surface. */}
      <div className="flex flex-col gap-7 px-5 pb-10 md:px-12 md:pb-12">
        <div className="grid gap-3 md:grid-cols-3 md:gap-5">
          <section className="flex items-start gap-3.5 rounded-2xl bg-sand p-[18px] md:flex-col md:gap-2.5 md:rounded-[18px] md:p-[26px]">
            <span
              aria-hidden="true"
              className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-amber md:mt-0 md:h-7 md:w-7"
            />
            <div className="flex flex-col gap-1 md:gap-2.5">
              <h3 className="font-display font-[650] text-ink text-[17.5px] md:text-[20px]">
                {t("cardLawTitle")}
              </h3>
              <p className="text-body-soft text-[14.5px] leading-[1.5] md:text-[15.5px] md:leading-[1.55]">
                {t("cardLawBody")}
              </p>
            </div>
          </section>
          <section className="flex items-start gap-3.5 rounded-2xl bg-sand p-[18px] md:flex-col md:gap-2.5 md:rounded-[18px] md:p-[26px]">
            <span
              aria-hidden="true"
              className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-amber md:mt-0 md:h-7 md:w-7"
            />
            <div className="flex flex-col gap-1 md:gap-2.5">
              <h3 className="font-display font-[650] text-ink text-[17.5px] md:text-[20px]">
                {t("cardPrivacyTitle")}
              </h3>
              <p className="text-body-soft text-[14.5px] leading-[1.5] md:text-[15.5px] md:leading-[1.55]">
                {t("cardPrivacyBody")}
              </p>
            </div>
          </section>
          <section className="flex items-start gap-3.5 rounded-2xl bg-emergency-bg p-[18px] md:flex-col md:gap-2.5 md:rounded-[18px] md:p-[26px]">
            <span
              aria-hidden="true"
              className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-emergency md:mt-0 md:h-7 md:w-7"
            />
            <div className="flex flex-col gap-1 md:gap-2.5">
              <h3 className="font-display font-[650] text-emergency text-[17.5px] md:text-[20px]">
                {t("cardDangerTitle")}
              </h3>
              <p className="text-body-soft text-[14.5px] leading-[1.5] md:text-[15.5px] md:leading-[1.55]">
                {t.rich("cardDangerBody", {
                  link: (chunks) => (
                    <Link
                      href="/emergency"
                      className="font-[650] text-emergency underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </div>
          </section>
        </div>

        <p className="max-w-[820px] text-muted text-[13.5px] leading-[1.55]">
          {t("disclaimer")}
        </p>
        <DeleteMyData />
      </div>
    </main>
  );
}
