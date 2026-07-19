import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Chat } from "@/components/Chat";
import { SiteHeader } from "@/components/SiteHeader";

/** Localized tab title ("Ask MigraAid — MigraAid" per locale). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "chat" });
  return { title: t("title") };
}

export default async function ChatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("chat");
  const tn = await getTranslations("nav");
  const th = await getTranslations("home");

  return (
    <main className="flex min-h-full flex-1 flex-col">
      <SiteHeader active="chat" mobileTitle={tn("ask")} />
      <h1 className="sr-only">{t("title")}</h1>
      <Chat />
      <p className="px-5 pb-6 pt-4 text-[13px] leading-[1.5] text-muted md:px-12">
        {th("disclaimer")}
      </p>
    </main>
  );
}
