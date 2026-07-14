import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ContractUpload } from "@/components/ContractUpload";

export default async function ContractPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contract");
  const tc = await getTranslations("common");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-sm text-blue-600">
          ← {tc("back")}
        </Link>
        <h1 className="text-xl font-bold">{t("title")}</h1>
      </div>
      <ContractUpload />
    </main>
  );
}
