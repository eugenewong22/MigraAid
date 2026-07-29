import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Chat } from "@/components/Chat";
import { SiteHeader } from "@/components/SiteHeader";
import { buildAlternates, buildOpenGraph } from "../layout";

/**
 * Localized tab title ("Ask MigraAid — MigraAid" per locale), plus canonical
 * alternates and OG. No page-specific description key exists for chat, so
 * this reuses the site-level `home.metaDescription` (also the layout's
 * inherited default) to keep the description in sync.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "chat" });
  const th = await getTranslations({ locale, namespace: "home" });
  const title = t("title");
  const description = th("metaDescription");
  return {
    title,
    description,
    alternates: buildAlternates(locale, "/chat"),
    openGraph: buildOpenGraph(locale, title, description),
  };
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
    <>
      <SiteHeader active="chat" mobileTitle={tn("ask")} />
      <main id="main" tabIndex={-1} className="flex min-h-full flex-1 flex-col">
      <h1 className="sr-only">{t("title")}</h1>
      <Chat />
      <p className="px-5 pb-6 pt-4 text-[13px] leading-[1.5] text-muted md:px-12">
        {th("disclaimer")}
      </p>
    </main>
    </>
  );
}
