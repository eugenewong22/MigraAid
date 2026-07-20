import type { Locale } from "./routing";

/**
 * Each supported language shown in its own native script, so a non-English
 * reader recognises it without translation. Used by the header language pill
 * (LocaleSwitcher): the full label at the `sm` breakpoint and up, and the
 * option text in the underlying <select>.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  bn: "বাংলা",
  ta: "தமிழ்",
  tl: "Tagalog",
  zh: "中文",
  id: "Bahasa Indonesia",
  th: "ไทย",
  my: "မြန်မာ",
};

/**
 * Short native-script abbreviation for the collapsed mobile pill (below
 * `sm`). A plain Latin two-letter code ("BN", "MY", "TA", "ZH"…) gives a
 * low-literacy or non-Latin-script reader no recognisable cue at all — "MY"
 * even misreads as Malaysia rather than Myanmar/Burmese. These stay short
 * (1-4 characters, matching the space the pill has on mobile) but keep a
 * native-script cue for non-Latin locales.
 */
export const LOCALE_LABELS_SHORT: Record<Locale, string> = {
  en: "EN",
  bn: "বাং",
  ta: "தமிழ்",
  tl: "Fil",
  zh: "中",
  id: "ID",
  th: "ไทย",
  my: "မြန်",
};
