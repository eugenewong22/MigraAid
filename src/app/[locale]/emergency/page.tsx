import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  EMERGENCY_CONTACTS,
  contactHref,
  type EmergencyCategory,
} from "@/lib/referral/emergency";
import { SiteHeader } from "@/components/SiteHeader";

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
      <SiteHeader active="emergency" breadcrumb={t("title")} />
      <h1 className="sr-only">{t("title")}</h1>

      {/* Urgent band — always call-first */}
      <div className="flex flex-col items-start gap-6 bg-emergency px-6 py-7 md:flex-row md:items-center md:justify-between md:px-12">
        <p className="max-w-[560px] text-[22px] font-[750] leading-[1.35] text-white">
          {t("intro")}
        </p>
        <div className="flex flex-wrap gap-4">
          <a
            href="tel:999"
            aria-label={`${policeName}, 999`}
            className="flex min-h-[76px] min-w-[150px] flex-col items-center justify-center rounded-[14px] bg-white font-extrabold text-emergency transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-emergency"
          >
            <span className="text-[26px]">
              <span aria-hidden="true">📞</span> 999
            </span>
            <span className="text-[13.5px] font-[650]">{policeName}</span>
          </a>
          <a
            href="tel:995"
            aria-label={`${ambulanceName}, 995`}
            className="flex min-h-[76px] min-w-[150px] flex-col items-center justify-center rounded-[14px] bg-white font-extrabold text-emergency transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-emergency"
          >
            <span className="text-[26px]">
              <span aria-hidden="true">📞</span> 995
            </span>
            <span className="text-[13.5px] font-[650]">{ambulanceName}</span>
          </a>
        </div>
      </div>

      {/* Directory — grouped */}
      <div className="grid grid-cols-1 gap-8 px-6 py-9 md:px-12 lg:grid-cols-3">
        {ORDER.map((cat) => {
          const items = EMERGENCY_CONTACTS.filter((c) => c.category === cat);
          if (items.length === 0) return null;
          const isUrgent = cat === "urgent";
          return (
            <section key={cat} className="flex flex-col gap-3">
              <h2
                className={
                  "border-b-2 pb-2 text-[15px] font-bold uppercase tracking-[0.06em] " +
                  (isUrgent
                    ? "border-serious-border text-emergency"
                    : "border-sky-faint text-navy")
                }
              >
                {t(cat)}
              </h2>
              <ul className="flex flex-col gap-3">
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
                        className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-surface px-4 text-[15.5px] font-bold text-navy transition-colors hover:bg-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2"
                      >
                        {isSms ? `SMS ${c.number}` : c.number}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="px-6 text-[13px] text-faint md:px-12">{t("verifyNote")}</p>
      <p className="px-6 pb-6 pt-3 text-[13px] leading-[1.5] text-muted md:px-12">
        {th("disclaimer")}
      </p>
    </main>
  );
}
