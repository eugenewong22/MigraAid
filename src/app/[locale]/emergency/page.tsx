import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  EMERGENCY_CONTACTS,
  contactHref,
  type EmergencyCategory,
} from "@/lib/referral/emergency";
import { SiteHeader } from "@/components/SiteHeader";

/** Localized tab title ("Emergency contacts — MigraAid" per locale). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "emergency" });
  return { title: t("title") };
}

const ORDER: EmergencyCategory[] = ["urgent", "government", "ngo"];

export default async function EmergencyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("emergency");
  const th = await getTranslations("home");

  const policeName = t("contacts.police.name");
  const ambulanceName = t("contacts.ambulanceFire.name");

  return (
    <main className="flex min-h-full flex-1 flex-col">
      <SiteHeader active="emergency" mobileTitle={t("title")} />
      <h1 className="sr-only">{t("title")}</h1>

      {/* Call-first band — full-width emergency surface */}
      <div className="flex flex-col gap-4 bg-emergency px-5 py-6 md:flex-row md:items-center md:justify-between md:gap-7 md:px-12 md:py-8">
        <p className="max-w-[520px] font-display text-[21px] font-[650] leading-[1.35] text-white md:text-[26px]">
          {t("intro")}
        </p>
        <div className="grid grid-cols-2 gap-3 md:flex md:gap-4">
          <a
            href="tel:999"
            aria-label={`${policeName}, 999`}
            className="flex min-h-[76px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-white text-emergency transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-emergency md:min-h-[80px] md:min-w-[160px]"
          >
            <span className="font-display text-[26px] font-extrabold md:text-[28px]">
              999
            </span>
            <span className="text-[13.5px] font-[650] md:text-[14px]">
              {policeName}
            </span>
          </a>
          <a
            href="tel:995"
            aria-label={`${ambulanceName}, 995`}
            className="flex min-h-[76px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-white text-emergency transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-emergency md:min-h-[80px] md:min-w-[160px]"
          >
            <span className="font-display text-[26px] font-extrabold md:text-[28px]">
              995
            </span>
            <span className="text-[13.5px] font-[650] md:text-[14px]">
              {ambulanceName}
            </span>
          </a>
        </div>
      </div>

      {/* Directory — grouped */}
      <div className="grid grid-cols-1 gap-y-6 px-5 py-8 md:px-12 md:py-[38px] lg:grid-cols-3 lg:gap-9">
        {ORDER.map((cat) => {
          const items = EMERGENCY_CONTACTS.filter((c) => c.category === cat);
          if (items.length === 0) return null;
          const isUrgent = cat === "urgent";
          return (
            <section key={cat} className="flex flex-col gap-2.5">
              <h2
                className={
                  "border-b-2 pb-2.5 text-[14px] font-bold uppercase tracking-[0.08em] " +
                  (isUrgent
                    ? "border-emergency-border text-emergency"
                    : "border-[#e0d4c0] text-terracotta")
                }
              >
                {t(cat)}
              </h2>
              <ul className="flex flex-col">
                {items.map((c) => {
                  const isSms = c.href?.startsWith("sms:");
                  return (
                    <li
                      key={c.id}
                      className="flex min-h-[52px] items-center justify-between gap-3"
                    >
                      <div className="flex flex-col">
                        <span className="text-[16.5px] font-[650] text-ink">
                          {t(`contacts.${c.id}.name`)}
                        </span>
                        {c.note && (
                          <span className="text-[13.5px] text-muted">
                            {t(`contacts.${c.id}.note`)}
                          </span>
                        )}
                      </div>
                      <a
                        href={contactHref(c)}
                        aria-label={t(`contacts.${c.id}.name`) + ": " + c.number}
                        className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-sand px-[18px] text-[15.5px] font-bold text-chip-text transition-colors hover:bg-sand-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
                      >
                        {isSms ? t("sms", { number: c.number }) : c.number}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="px-5 text-[13px] text-muted md:px-12">{t("verifyNote")}</p>
      <p className="px-5 pb-6 pt-3 text-[13px] leading-[1.5] text-muted md:px-12">
        {th("disclaimer")}
      </p>
    </main>
  );
}
