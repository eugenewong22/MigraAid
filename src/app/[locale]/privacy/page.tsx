import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import { DeleteMyData } from "@/components/DeleteMyData";
import { buildAlternates } from "../layout";
import { retentionDays } from "@/lib/privacy/retention";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacyPage" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: buildAlternates(locale, "/privacy"),
  };
}

/**
 * What MigraAid does with a worker's data, in plain language.
 *
 * Purely descriptive, which is why it is writable without a lawyer — and it has
 * to exist: PDPA applies, and the product handles free-text questions, contract
 * photographs, IP-derived hashes and a persistent cookie.
 *
 * The section that matters most is the third-party one. "Sent to an AI
 * provider" was true but uninformative; a worker deciding whether to photograph
 * a contract carrying their name, passport number and employer needs to know
 * which company, in which country, and for how long.
 */
export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "privacyPage" });
  const days = retentionDays();

  const sections = [
    { heading: t("collectHeading"), body: t("collectBody") },
    { heading: t("providerHeading"), body: t("providerBody") },
    { heading: t("retentionHeading"), body: t("retentionBody", { days }) },
    { heading: t("cookieHeading"), body: t("cookieBody", { days }) },
    { heading: t("rightsHeading"), body: t("rightsBody") },
    { heading: t("contactHeading"), body: t("contactBody") },
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

          <DeleteMyData />
        </div>
      </main>
    </>
  );
}
