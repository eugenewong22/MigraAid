import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ContractUpload } from "@/components/ContractUpload";
import { SiteHeader } from "@/components/SiteHeader";
import { buildAlternates, buildOpenGraph } from "../layout";

/**
 * Localized tab title ("Explain my contract — MigraAid" per locale), plus
 * canonical alternates and OG. No page-specific description key exists for
 * contract, so this reuses the site-level `home.metaDescription` (also the
 * layout's inherited default) to keep the description in sync.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contract" });
  const th = await getTranslations({ locale, namespace: "home" });
  const title = t("title");
  const description = th("metaDescription");
  return {
    title,
    description,
    alternates: buildAlternates(locale, "/contract"),
    openGraph: buildOpenGraph(locale, title, description),
  };
}

export default async function ContractPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contract");
  const th = await getTranslations("home");

  return (
    <main className="flex min-h-full flex-1 flex-col">
      <SiteHeader active="contract" mobileTitle={t("title")} />
      <ContractUpload />
      <p className="px-5 pb-6 text-[13px] leading-[1.5] text-muted md:px-12">
        {th("disclaimer")}
      </p>
    </main>
  );
}
