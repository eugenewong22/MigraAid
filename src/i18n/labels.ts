import type { Locale } from "./routing";

/**
 * Each supported language shown in its own native script, so a non-English
 * reader recognises it without translation. Used by the header language pill
 * and the home-screen language picker.
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
