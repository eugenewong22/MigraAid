"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** Each language shown in its own script so a non-English reader recognises it. */
const LABELS: Record<string, string> = {
  en: "English",
  bn: "বাংলা",
  ta: "தமிழ்",
  tl: "Tagalog",
  zh: "中文",
  id: "Bahasa Indonesia",
  th: "ไทย",
  my: "မြန်မာ",
};

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();

  return (
    <select
      aria-label={t("language")}
      value={locale}
      onChange={(e) => router.replace(pathname, { locale: e.target.value })}
      className="min-h-11 rounded-lg border px-2 py-1 text-sm"
    >
      {routing.locales.map((l) => (
        <option key={l} value={l}>
          {LABELS[l] ?? l}
        </option>
      ))}
    </select>
  );
}
