"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  CONTRACT_UPLOAD_IMAGE_TYPES,
  contractUploadErrorForStatus,
  validateContractUpload,
} from "@/lib/contract/upload";

interface FlaggedClause {
  clause: string;
  concern: string;
  severity: "info" | "warning" | "serious";
}

interface Analysis {
  summary: string;
  keyTerms: { label: string; value: string }[];
  flaggedClauses: FlaggedClause[];
  /** null means storage was not requested; booleans report an opted-in attempt. */
  saved?: boolean | null;
}

/** Flag row surface (background) per severity, per the Daybreak tokens. */
const SEVERITY_ROW: Record<FlaggedClause["severity"], string> = {
  info: "bg-sand",
  warning: "bg-warn-bg",
  serious: "bg-emergency-bg",
};

/** Severity chip (pill background + text) per severity. */
const SEVERITY_CHIP: Record<FlaggedClause["severity"], string> = {
  info: "bg-sand text-chip-text",
  warning: "bg-amber text-warn-text",
  serious: "bg-emergency text-white",
};

const SEVERITY_LABELS = {
  info: "severityInfo",
  warning: "severityWarning",
  serious: "severitySerious",
} as const;

/** Card title shared by Summary / Key terms / Points to check. */
const CARD_TITLE = "font-display text-[20px] font-[650] text-ink";

export function ContractUpload() {
  const t = useTranslations("contract");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [saveAnalysis, setSaveAnalysis] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null);

  // Move keyboard/screen-reader focus to the results when they arrive; the
  // upload control keeps focus during analysis (it is never disabled, which
  // would silently drop focus to the document).
  useEffect(() => {
    if (analysis) summaryHeadingRef.current?.focus();
  }, [analysis]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const input = e.currentTarget;
    if (busy) {
      input.value = "";
      return;
    }
    setError("");
    setAnalysis(null);
    const validationError = validateContractUpload(file);
    if (validationError) {
      setError(t(validationError));
      input.value = "";
      return;
    }

    setBusy(true);
    // A dropped connection would otherwise leave `fetch` pending forever,
    // stranding `busy` with no retry but a reload (same class of hang as the
    // chat fetch). Contract analysis legitimately takes up to ~50s, so the
    // deadline is generous enough for a real slow analysis to finish while
    // still bounding a black-holed socket.
    const CONTRACT_TIMEOUT_MS = 70_000;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), CONTRACT_TIMEOUT_MS);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("locale", locale);
      fd.append("saveAnalysis", String(saveAnalysis));
      const res = await fetch("/api/contract", {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });
      if (!res.ok) {
        setError(t(contractUploadErrorForStatus(res.status)));
        return;
      }
      const data = await res.json();
      setAnalysis(data as Analysis);
    } catch {
      setError(t("error"));
    } finally {
      clearTimeout(timeoutTimer);
      input.value = "";
      setBusy(false);
    }
  }

  const hasSeriousConcern = analysis?.flaggedClauses.some(
    (clause) => clause.severity === "serious",
  );

  return (
    <div aria-busy={busy} className="w-full px-5 py-8 md:px-12 md:py-10">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6">
        {/* On mobile the site header already shows this title; keep the h1 in
            the a11y tree (page heading) but hide it visually there to avoid a
            duplicate. On desktop the header shows the wordmark, so it is shown. */}
        <h1 className="font-display text-[30px] font-[650] leading-[1.1] text-ink sr-only sm:not-sr-only md:text-[38px]">
          {t("title")}
        </h1>

        <input
          id="contract-file"
          type="file"
          accept={CONTRACT_UPLOAD_IMAGE_TYPES.join(",")}
          onChange={onFile}
          className="peer sr-only"
          aria-describedby="contract-privacy contract-save-analysis"
        />
        <label
          htmlFor="contract-file"
          className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-[20px] border-2 border-dashed border-line bg-paper p-7 text-center transition-colors hover:border-terracotta hover:bg-cream peer-focus-visible:border-terracotta peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-terracotta peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-cream"
        >
          <span
            aria-hidden="true"
            className="h-9 w-9 rounded-full bg-amber"
          />
          <span className="font-display text-[18px] font-bold text-ink">
            {busy ? t("analyzing") : t("upload")}
          </span>
          <span className="text-[14px] text-muted">{t("fileHint")}</span>
        </label>

        <p
          id="contract-privacy"
          className="rounded-xl bg-sand px-4 py-3 text-[13.5px] leading-[1.55] text-muted md:px-[18px]"
        >
          {t("privacy")}
        </p>

        <label
          id="contract-save-analysis"
          className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[14px] border border-hairline bg-paper p-4 text-[14px] leading-[1.5] text-body-soft"
        >
          <input
            type="checkbox"
            name="saveAnalysis"
            checked={saveAnalysis}
            onChange={(event) => setSaveAnalysis(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-terracotta"
          />
          <span>{t("saveAnalysis")}</span>
        </label>

        {/* Single persistent status region: announces progress and then a
            short "ready" cue — never the whole analysis (the results region
            below is deliberately NOT live so screen-reader users can read it
            at their own pace instead of hearing one atomic monologue). */}
        <p className="sr-only" role="status">
          {busy ? t("analyzing") : analysis ? t("analysisReady") : ""}
        </p>
        {error && (
          <p className="text-[14px] text-emergency" role="alert">
            {error}
          </p>
        )}

        {/* Results */}
        <div
          className={analysis ? "flex flex-col gap-4" : "sr-only"}
          role="region"
          aria-labelledby={analysis ? "contract-summary-heading" : undefined}
        >
          {analysis && (
            <>
              {analysis.saved === true && (
                <p
                  className="rounded-xl bg-sand px-4 py-3 text-[14px] leading-[1.5] text-body-soft md:px-[18px]"
                  role="status"
                >
                  {t("savedConfirmation")}
                </p>
              )}
              {analysis.saved === false && (
                <p
                  className="rounded-xl border border-warn-border bg-warn-bg px-4 py-3 text-[14px] leading-[1.5] text-warn-text md:px-[18px]"
                  role="alert"
                >
                  {t("saveFailed")}
                </p>
              )}

              <section
                aria-labelledby="contract-summary-heading"
                className="flex flex-col gap-2.5 rounded-[18px] border border-hairline bg-paper p-6 md:px-7"
              >
                <h2
                  id="contract-summary-heading"
                  ref={summaryHeadingRef}
                  tabIndex={-1}
                  className={`${CARD_TITLE} focus:outline-none`}
                >
                  {t("summary")}
                </h2>
                <p className="whitespace-pre-wrap text-[16px] leading-[1.6] text-body-soft">
                  {analysis.summary}
                </p>
              </section>

              {analysis.keyTerms.length > 0 && (
                <section
                  aria-labelledby="contract-key-terms-heading"
                  className="flex flex-col gap-3 rounded-[18px] border border-hairline bg-paper p-6 md:px-7"
                >
                  <h2 id="contract-key-terms-heading" className={CARD_TITLE}>
                    {t("keyTerms")}
                  </h2>
                  <dl className="grid grid-cols-1 gap-x-7 gap-y-2.5 sm:grid-cols-2">
                    {analysis.keyTerms.map((k, i) => (
                      <div
                        key={i}
                        className="flex items-baseline justify-between gap-3 border-b border-sand-deep pb-2.5"
                      >
                        <dt className="text-[15px] text-muted">{k.label}</dt>
                        <dd className="text-right text-[15px] font-[600] text-ink">
                          {k.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              <section
                aria-labelledby="contract-flags-heading"
                className="flex flex-col gap-3.5 rounded-[18px] border border-hairline bg-paper p-6 md:px-7"
              >
                <h2 id="contract-flags-heading" className={CARD_TITLE}>
                  {t("flags")}
                </h2>
                {analysis.flaggedClauses.length > 0 ? (
                  <ul className="flex flex-col gap-3">
                    {analysis.flaggedClauses.map((c, i) => (
                      <li
                        key={i}
                        className={`flex gap-3.5 rounded-[14px] p-4 md:px-[18px] ${SEVERITY_ROW[c.severity]}`}
                      >
                        <span
                          className={`inline-flex min-h-[30px] shrink-0 items-center self-start rounded-full px-3 text-[12.5px] font-bold uppercase tracking-[0.04em] ${SEVERITY_CHIP[c.severity]}`}
                        >
                          <span className="sr-only">{t("severity")}: </span>
                          {t(SEVERITY_LABELS[c.severity])}
                        </span>
                        <div className="flex flex-col gap-1">
                          <p className="text-[15.5px] font-[600] leading-[1.5] text-ink">
                            {c.clause}
                          </p>
                          <p className="text-[15.5px] leading-[1.55] text-body-soft">
                            {c.concern}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-[14px] bg-sand p-4 text-[15px] text-body-soft md:px-[18px]">
                    {t("noFlags")}
                  </p>
                )}
                <p className="border-t border-sand-deep pt-3.5 text-[13.5px] leading-[1.55] text-muted">
                  {t("analysisCaveat")}
                </p>

                {hasSeriousConcern && (
                  <Link
                    href="/emergency"
                    className="inline-flex min-h-[52px] items-center justify-center self-start rounded-full bg-emergency px-6 text-[16px] font-bold text-white transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emergency focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
                  >
                    {t("seriousCta")}
                  </Link>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
