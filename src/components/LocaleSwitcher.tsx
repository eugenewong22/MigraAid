"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { LOCALE_LABELS } from "@/i18n/labels";

/**
 * Header language control. Rendered as the Daybreak "English ▾" pill from the
 * design (no globe emoji), but driven by a real (transparent) native <select>
 * layered on top so it stays a keyboard-accessible combobox with the "Language"
 * accessible name. Abbreviates to a two-letter code on mobile.
 */
export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const label = LOCALE_LABELS[locale] ?? locale;

  return (
    <div className="relative inline-flex">
      <select
        aria-label={t("language")}
        value={locale}
        onChange={(e) =>
          router.replace(pathname, { locale: e.target.value as Locale })
        }
        className="peer absolute inset-0 h-full w-full cursor-pointer text-[16px] opacity-0"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_LABELS[l] ?? l}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-line px-3.5 text-[14px] text-body transition-colors peer-hover:bg-sand peer-focus-visible:ring-2 peer-focus-visible:ring-terracotta peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-cream md:px-[18px] md:text-[15px]"
      >
        <span className="sm:hidden">{locale.slice(0, 2).toUpperCase()}</span>
        <span className="hidden sm:inline">{label}</span>
        <span className="text-xs opacity-80">▾</span>
      </span>
    </div>
  );
}
