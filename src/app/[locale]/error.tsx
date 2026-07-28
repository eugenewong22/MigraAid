"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

/**
 * Recoverable error boundary for the localized route tree.
 *
 * Distinct from `global-error.tsx`, which replaces the whole document and
 * therefore cannot use next-intl — it carries its own hardcoded copy in eight
 * languages. This one still has a provider, so a worker sees the failure in
 * their own language and keeps the header, the footer and the emergency link.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
    // Next has already reported this to the instrumentation hook; log the
    // digest so a Vercel log line can be matched to a Sentry event without
    // putting anything from the worker's question into the console.
    if (error.digest) console.error(`[render] digest=${error.digest}`);
  }, [error.digest]);

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-[820px] flex-1 flex-col gap-4 px-5 py-10 md:px-12"
    >
      <h1 className="font-display text-[24px] leading-[1.25] text-ink">
        {t("errorTitle")}
      </h1>
      <p role="alert" className="text-[16px] leading-[1.6] text-body">
        {t("errorBody")}
      </p>
      <button
        type="button"
        onClick={reset}
        className="self-start min-h-11 rounded-lg bg-terracotta px-5 font-semibold text-cream"
      >
        {t("retry")}
      </button>
    </main>
  );
}
