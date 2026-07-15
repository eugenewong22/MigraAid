"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { LOCALE_LABELS } from "@/i18n/labels";

/**
 * Header language control. Rendered as the navy "🌐 English ▾" pill from the
 * design, but driven by a real (transparent) native <select> layered on top so
 * it stays a keyboard-accessible combobox with the "Language" accessible name.
 */
export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="relative inline-flex">
      <select
        aria-label={t("language")}
        value={locale}
        onChange={(e) =>
          router.replace(pathname, { locale: e.target.value as Locale })
        }
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l] ?? l}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none inline-flex min-h-11 items-center gap-2 rounded-full border border-white/35 px-4 text-[15px] text-white transition-colors peer-hover:bg-white/10 peer-focus-visible:ring-2 peer-focus-visible:ring-sky peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-navy"
      >
        <span aria-hidden="true">🌐</span>
        {LOCALE_LABELS[locale] ?? locale}
        <span aria-hidden="true" className="text-xs opacity-80">
          ▾
        </span>
      </span>
    </div>
  );
}
