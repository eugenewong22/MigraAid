import { getTranslations, setRequestLocale } from "next-intl/server";
import { ContractUpload } from "@/components/ContractUpload";
import { SiteHeader } from "@/components/SiteHeader";

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
      <SiteHeader active="contract" breadcrumb={t("title")} />
      <div className="flex flex-1 flex-col px-6 md:px-12">
        <ContractUpload />
      </div>
      <p className="px-6 pb-6 text-[13px] leading-[1.5] text-muted md:px-12">
        {th("disclaimer")}
      </p>
    </main>
  );
}
