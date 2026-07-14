import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <LocaleSwitcher />
      </header>

      <p className="text-lg">{t("tagline")}</p>

      <nav className="flex flex-col gap-3">
        <Link
          href="/chat"
          className="rounded-xl bg-blue-600 px-5 py-4 text-center text-lg font-semibold text-white"
        >
          {t("startChat")}
        </Link>
        <Link
          href="/contract"
          className="rounded-xl border px-5 py-4 text-center text-lg font-semibold"
        >
          {t("contractCta")}
        </Link>
        <Link
          href="/emergency"
          className="rounded-xl border px-5 py-4 text-center text-lg font-semibold"
        >
          {t("emergencyCta")}
        </Link>
      </nav>

      <p className="mt-auto text-sm text-neutral-500">{t("disclaimer")}</p>
    </main>
  );
}
