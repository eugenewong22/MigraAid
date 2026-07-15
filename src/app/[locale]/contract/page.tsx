import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ContractUpload } from "@/components/ContractUpload";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export default async function ContractPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contract");
  const tc = await getTranslations("common");
  const th = await getTranslations("home");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center text-sm text-blue-600"
          >
            ← {tc("back")}
          </Link>
          <h1 className="text-xl font-bold">{t("title")}</h1>
        </div>
        <LocaleSwitcher />
      </div>
      <ContractUpload />
      <p className="text-sm text-neutral-500">{th("disclaimer")}</p>
    </main>
  );
}
