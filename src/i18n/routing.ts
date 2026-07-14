import { defineRouting } from "next-intl/routing";

/**
 * The eight languages MigraAid supports:
 * English, Bengali, Tamil, Tagalog, Mandarin, Bahasa Indonesia, Thai, Burmese.
 */
export const routing = defineRouting({
  locales: ["en", "bn", "ta", "tl", "zh", "id", "th", "my"],
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];
