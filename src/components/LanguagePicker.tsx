"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { LOCALE_LABELS } from "@/i18n/labels";

/**
 * First-launch language picker on the home hero: one button per locale, in its
 * native script. Selecting routes to that locale (same logic as the header
 * LocaleSwitcher); the current locale gets the filled sky style.
 */
export function LanguagePicker() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {routing.locales.map((l) => {
        const selected = l === locale;
        return (
          <button
            key={l}
            type="button"
            lang={l}
            aria-current={selected ? "true" : undefined}
            onClick={() => router.replace(pathname, { locale: l })}
            className={
              "min-h-[50px] rounded-[9px] border text-[17px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2 focus-visible:ring-offset-navy " +
              (selected
                ? "border-sky bg-sky font-[650] text-navy"
                : "border-white/30 bg-transparent text-white hover:bg-white/10")
            }
          >
            {LOCALE_LABELS[l] ?? l}
          </button>
        );
      })}
    </div>
  );
}
