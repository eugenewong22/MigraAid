import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Chat } from "@/components/Chat";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("chat");
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
      <Chat />
      <p className="text-sm text-neutral-500">{th("disclaimer")}</p>
    </main>
  );
}
