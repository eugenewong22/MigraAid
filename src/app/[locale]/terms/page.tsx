import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import { buildAlternates } from "../layout";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "termsPage" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: buildAlternates(locale, "/terms"),
  };
}

/**
 * Terms of use, deliberately short and plain.
 *
 * Not a corporate document: no indemnities, no limitation-of-liability caps, no
 * arbitration clause. Those are largely unenforceable for an individual running
 * a free service, and they read as adversarial to an audience that is already
 * wary of anyone asking them to agree to something.
 *
 * What this is for is findability — the disclaimer already appears on every
 * page, and this gives it a stable place to live and be linked to.
 */
export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "termsPage" });

  const sections = [
    { heading: t("notAdviceHeading"), body: t("notAdviceBody") },
    { heading: t("accuracyHeading"), body: t("accuracyBody") },
    { heading: t("independenceHeading"), body: t("independenceBody") },
    { heading: t("useHeading"), body: t("useBody") },
    { heading: t("changesHeading"), body: t("changesBody") },
  ];

  return (
    <>
      <SiteHeader mobileTitle={t("title")} />
      <main id="main" tabIndex={-1} className="flex min-h-full flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-5 py-8 md:px-12">
          <h1 className="font-display text-[28px] leading-[1.2] text-ink md:text-[34px]">
            {t("title")}
          </h1>
          <p className="text-[17px] leading-[1.6] text-body">{t("intro")}</p>

          {sections.map((section) => (
            <section key={section.heading} className="flex flex-col gap-2">
              <h2 className="font-display text-[20px] leading-[1.3] text-ink">
                {section.heading}
              </h2>
              <p className="text-[16px] leading-[1.6] text-body">{section.body}</p>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
