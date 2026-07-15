import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  EMERGENCY_CONTACTS,
  contactHref,
  type EmergencyCategory,
} from "@/lib/referral/emergency";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

const ORDER: EmergencyCategory[] = ["urgent", "government", "ngo"];

export default async function EmergencyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("emergency");
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

      <p className="rounded-lg bg-red-50 p-3 text-red-800">{t("intro")}</p>

      {ORDER.map((cat) => {
        const items = EMERGENCY_CONTACTS.filter((c) => c.category === cat);
        if (items.length === 0) return null;
        return (
          <section key={cat}>
            <h2 className="mb-2 text-sm font-semibold uppercase text-neutral-500">
              {t(cat)}
            </h2>
            <ul className="flex flex-col gap-2">
              {items.map((c) => (
                <li
                  key={c.name}
                  className="flex items-center justify-between gap-3 rounded-xl border p-3"
                >
                  <div>
                    <p className="font-medium">{t(`contacts.${c.id}.name`)}</p>
                    {c.note && (
                      <p className="text-xs text-neutral-500">
                        {t(`contacts.${c.id}.note`)}
                      </p>
                    )}
                  </div>
                  <a
                    href={contactHref(c)}
                    aria-label={t(`contacts.${c.id}.name`) + ": " + c.number}
                    className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white"
                  >
                    {c.number}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="mt-auto text-xs text-neutral-500">{t("verifyNote")}</p>
      <p className="text-sm text-neutral-500">{th("disclaimer")}</p>
    </main>
  );
}
