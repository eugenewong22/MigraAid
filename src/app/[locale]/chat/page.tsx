import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("chat");
  const tc = await getTranslations("common");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-sm text-blue-600">
          ← {tc("back")}
        </Link>
        <h1 className="text-xl font-bold">{t("title")}</h1>
      </div>
      {/* M1 replaces this with the streaming RAG chat interface. */}
      <p className="text-neutral-500">{t("comingSoon")}</p>
    </main>
  );
}
