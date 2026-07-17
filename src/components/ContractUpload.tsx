"use client";

import { useState } from "react";
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

/** Card surface (border + background) per severity, per the design tokens. */
const SEVERITY_CARD: Record<FlaggedClause["severity"], string> = {
  info: "border-hairline bg-surface",
  warning: "border-warn-border bg-warn-bg",
  serious: "border-serious-border bg-serious-bg",
};

/** Severity chip text colour. */
const SEVERITY_CHIP: Record<FlaggedClause["severity"], string> = {
  info: "text-body",
  warning: "text-warn-text",
  serious: "text-emergency",
};

const SEVERITY_LABELS = {
  info: "severityInfo",
  warning: "severityWarning",
  serious: "severitySerious",
} as const;

const SECTION_LABEL =
  "text-[15px] font-bold uppercase tracking-[0.06em] text-muted";

export function ContractUpload() {
  const t = useTranslations("contract");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [saveAnalysis, setSaveAnalysis] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const input = e.currentTarget;
    setError("");
    setAnalysis(null);
    const validationError = validateContractUpload(file);
    if (validationError) {
      setError(t(validationError));
      input.value = "";
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("locale", locale);
      fd.append("saveAnalysis", String(saveAnalysis));
      const res = await fetch("/api/contract", { method: "POST", body: fd });
      if (!res.ok) {
        setError(t(contractUploadErrorForStatus(res.status)));
        return;
      }
      const data = await res.json();
      setAnalysis(data as Analysis);
    } catch {
      setError(t("error"));
    } finally {
      input.value = "";
      setBusy(false);
    }
  }

  const hasSeriousConcern = analysis?.flaggedClauses.some(
    (clause) => clause.severity === "serious",
  );

  return (
    <div aria-busy={busy} className="w-full py-10">
      <div
        className={
          analysis
            ? "grid grid-cols-1 gap-10 lg:grid-cols-[420px_1fr]"
            : "mx-auto w-full max-w-xl"
        }
      >
        {/* Left: upload controls */}
        <div className="flex flex-col gap-4">
          <h1 className="text-[26px] font-[750] tracking-[-0.01em] text-ink">
            {t("title")}
          </h1>
          <p id="contract-privacy" className="text-[13.5px] leading-[1.5] text-muted">
            {t("privacy")}
          </p>
          <input
            id="contract-file"
            type="file"
            accept={CONTRACT_UPLOAD_IMAGE_TYPES.join(",")}
            onChange={onFile}
            className="peer sr-only"
            disabled={busy}
            aria-describedby="contract-privacy contract-save-analysis"
          />
          <label
            htmlFor="contract-file"
            className="flex min-h-[64px] cursor-pointer items-center justify-center gap-2.5 rounded-[12px] bg-navy px-4 text-center text-[18px] font-bold text-white transition-colors hover:bg-navy-hover peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-navy peer-focus-visible:ring-offset-2"
          >
            <span aria-hidden="true">📷</span>
            {busy ? t("analyzing") : t("upload")}
          </label>
          <label
            id="contract-save-analysis"
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[12px] border border-hairline p-4 text-[14px] leading-[1.5] text-body"
          >
            <input
              type="checkbox"
              name="saveAnalysis"
              checked={saveAnalysis}
              onChange={(event) => setSaveAnalysis(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-navy"
              disabled={busy}
            />
            <span>{t("saveAnalysis")}</span>
          </label>
          {busy && (
            <p className="sr-only" role="status">
              {t("analyzing")}
            </p>
          )}
          {error && (
            <p className="text-[14px] text-emergency" role="alert">
              {error}
            </p>
          )}
        </div>

        {/* Right: results */}
        <div
          className={
            analysis
              ? "flex flex-col gap-[22px] lg:border-l lg:border-hairline lg:pl-10"
              : "sr-only"
          }
          role="region"
          aria-labelledby={analysis ? "contract-summary-heading" : undefined}
          aria-live="polite"
          aria-atomic="true"
        >
          {analysis && (
            <>
            {analysis.saved === true && (
              <p
                className="rounded-[10px] bg-saved-bg px-4 py-3 text-[14px] text-saved-text"
                role="status"
              >
                {t("savedConfirmation")}
              </p>
            )}
            {analysis.saved === false && (
              <p
                className="rounded-[10px] bg-warn-bg px-4 py-3 text-[14px] text-warn-text"
                role="alert"
              >
                {t("saveFailed")}
              </p>
            )}

            <section
              aria-labelledby="contract-summary-heading"
              className="flex flex-col gap-2"
            >
              <h2 id="contract-summary-heading" className={SECTION_LABEL}>
                {t("summary")}
              </h2>
              <p className="whitespace-pre-wrap text-[16.5px] leading-[1.55] text-ink">
                {analysis.summary}
              </p>
            </section>

            {analysis.keyTerms.length > 0 && (
              <section
                aria-labelledby="contract-key-terms-heading"
                className="flex flex-col gap-2"
              >
                <h2 id="contract-key-terms-heading" className={SECTION_LABEL}>
                  {t("keyTerms")}
                </h2>
                <ul className="grid grid-cols-1 gap-y-2 sm:grid-cols-2 sm:gap-x-6">
                  {analysis.keyTerms.map((k, i) => (
                    <li key={i} className="text-[16px] text-body">
                      <strong className="font-[650] text-ink">{k.label}:</strong>{" "}
                      {k.value}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section
              aria-labelledby="contract-flags-heading"
              className="flex flex-col gap-2.5"
            >
              <h2 id="contract-flags-heading" className={SECTION_LABEL}>
                {t("flags")}
              </h2>
              {analysis.flaggedClauses.length > 0 ? (
                <ul className="flex flex-col gap-2.5">
                  {analysis.flaggedClauses.map((c, i) => (
                    <li
                      key={i}
                      className={`flex flex-col gap-1 rounded-[12px] border p-4 ${SEVERITY_CARD[c.severity]}`}
                    >
                      <span
                        className={`text-[12.5px] font-extrabold uppercase tracking-[0.06em] ${SEVERITY_CHIP[c.severity]}`}
                      >
                        <span className="sr-only">{t("severity")}: </span>
                        {t(SEVERITY_LABELS[c.severity])}
                      </span>
                      <p className="text-[16px] font-[650] text-ink">{c.clause}</p>
                      <p className="text-[15px] leading-[1.5] text-body">
                        {c.concern}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-[12px] bg-surface p-4 text-[15px] text-body">
                  {t("noFlags")}
                </p>
              )}
              <p className="text-[13.5px] leading-[1.5] text-muted">
                {t("analysisCaveat")}
              </p>

              {hasSeriousConcern && (
                <Link
                  href="/emergency"
                  className="inline-flex min-h-12 items-center justify-center self-start rounded-[10px] bg-emergency px-[22px] text-[16px] font-bold text-white transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emergency focus-visible:ring-offset-2"
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
