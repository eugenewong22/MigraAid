import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

type Messages = Record<string, Record<string, string>>;

/**
 * Shallow-merge a locale's messages over the English defaults, so any key that
 * hasn't been translated yet falls back to English instead of crashing the page.
 * (Our catalogs are two levels deep: section → key.)
 */
function withFallback(en: Messages, locale: Messages): Messages {
  const out: Messages = { ...en };
  for (const section of Object.keys(locale)) {
    out[section] = { ...(en[section] ?? {}), ...locale[section] };
  }
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const en = (await import("../../messages/en.json")).default as Messages;
  const messages =
    locale === "en"
      ? en
      : withFallback(
          en,
          (await import(`../../messages/${locale}.json`)).default as Messages,
        );

  return { locale, messages };
});
