import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { LanguagePicker } from "@/components/LanguagePicker";
import { DeleteMyData } from "@/components/DeleteMyData";

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

      {/* Navy block: header + hero */}
      <div className="bg-navy px-6 md:px-12">
        <SiteHeader embedded />

        <div className="grid grid-cols-1 items-center gap-10 py-12 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pb-[72px] lg:pt-16">
          <div className="order-2 flex flex-col gap-5 lg:order-1">
            <span className="text-[14px] font-bold uppercase tracking-[0.1em] text-sky">
              {t("eyebrow")}
            </span>
            <h2 className="text-[34px] font-[750] leading-[1.1] tracking-[-0.02em] text-white sm:text-[48px]">
              {t("tagline")}
            </h2>
            <p className="text-[19px] leading-[1.55] text-sky-muted">
              {t("heroLede")}
            </p>
            <div className="mt-2 flex flex-wrap gap-3.5">
              <Link
                href="/chat"
                className="inline-flex min-h-[52px] items-center justify-center rounded-[10px] bg-sky px-7 text-[17px] font-bold text-navy transition-colors hover:bg-sky-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
              >
                {t("startChat")}
              </Link>
              <Link
                href="/contract"
                className="inline-flex min-h-[52px] items-center justify-center rounded-[10px] border border-white/40 px-7 text-[17px] font-[600] text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
              >
                {t("contractCta")}
              </Link>
            </div>
          </div>

          <div className="order-1 flex flex-col gap-3.5 rounded-2xl border border-white/15 bg-white/[0.07] p-6 lg:order-2">
            <p className="text-[14px] font-bold uppercase tracking-[0.08em] text-sky-faint">
              {t("chooseLanguage")}
            </p>
            <LanguagePicker />
          </div>
        </div>
      </div>

      {/* Below hero: three editorial columns with top rules */}
      <div className="flex flex-col gap-7 px-6 py-10 md:px-12 md:pb-12">
        <div className="grid gap-6 md:grid-cols-3">
          <section className="flex flex-col gap-2 border-t-[3px] border-navy pt-5">
            <h3 className="text-[20px] font-bold text-ink">{t("cardLawTitle")}</h3>
            <p className="text-[15.5px] leading-[1.5] text-body-soft">
              {t("cardLawBody")}
            </p>
          </section>
          <section className="flex flex-col gap-2 border-t-[3px] border-navy pt-5">
            <h3 className="text-[20px] font-bold text-ink">
              {t("cardPrivacyTitle")}
            </h3>
            <p className="text-[15.5px] leading-[1.5] text-body-soft">
              {t("cardPrivacyBody")}
            </p>
          </section>
          <section className="flex flex-col gap-2 border-t-[3px] border-emergency pt-5">
            <h3 className="text-[20px] font-bold text-emergency">
              {t("cardDangerTitle")}
            </h3>
            <p className="text-[15.5px] leading-[1.5] text-body-soft">
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
          </section>
        </div>

        <p className="text-[14px] leading-[1.5] text-muted">{t("disclaimer")}</p>
        <DeleteMyData />
      </div>
    </main>
  );
}
