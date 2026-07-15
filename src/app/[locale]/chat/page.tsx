import { getTranslations, setRequestLocale } from "next-intl/server";
import { Chat } from "@/components/Chat";
import { SiteHeader } from "@/components/SiteHeader";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("chat");
  const th = await getTranslations("home");

  return (
    <main className="flex min-h-full flex-1 flex-col">
      <SiteHeader active="chat" breadcrumb={th("startChat")} />
      <h1 className="sr-only">{t("title")}</h1>
      <div className="flex flex-1 flex-col px-6 md:px-12">
        <Chat />
      </div>
      <p className="px-6 pb-6 text-[13px] leading-[1.5] text-muted md:px-12">
        {th("disclaimer")}
      </p>
    </main>
  );
}
