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

const SEVERITY_STYLES: Record<FlaggedClause["severity"], string> = {
  info: "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100",
  warning: "bg-amber-100 text-amber-900",
  serious: "bg-red-100 text-red-900",
};

const SEVERITY_LABELS = {
  info: "severityInfo",
  warning: "severityWarning",
  serious: "severitySerious",
} as const;

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
    <div className="flex flex-col gap-4" aria-busy={busy}>
      <input
        id="contract-file"
        type="file"
        accept={CONTRACT_UPLOAD_IMAGE_TYPES.join(",")}
        onChange={onFile}
        className="peer sr-only"
        disabled={busy}
        aria-describedby="contract-privacy contract-save-analysis"
      />
      <p id="contract-privacy" className="text-xs text-neutral-500">
        {t("privacy")}
      </p>
      <label
        htmlFor="contract-file"
        className="cursor-pointer rounded-xl bg-blue-600 px-5 py-4 text-center text-lg font-semibold text-white outline-none peer-focus-visible:ring-4 peer-focus-visible:ring-blue-300 peer-focus-visible:ring-offset-2"
      >
        {busy ? t("analyzing") : t("upload")}
      </label>
      <label
        id="contract-save-analysis"
        className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"
      >
        <input
          type="checkbox"
          name="saveAnalysis"
          checked={saveAnalysis}
          onChange={(event) => setSaveAnalysis(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-blue-600"
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
        <p className="text-red-600" role="alert">
          {error}
        </p>
      )}

      {analysis && (
        <div
          className="flex flex-col gap-4"
          role="region"
          aria-labelledby="contract-summary-heading"
          aria-live="polite"
        >
          {analysis.saved === true && (
            <p
              className="rounded-lg bg-green-100 p-3 text-sm text-green-900"
              role="status"
            >
              {t("savedConfirmation")}
            </p>
          )}
          {analysis.saved === false && (
            <p
              className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900"
              role="alert"
            >
              {t("saveFailed")}
            </p>
          )}

          <section aria-labelledby="contract-summary-heading">
            <h2 id="contract-summary-heading" className="mb-1 font-semibold">
              {t("summary")}
            </h2>
            <p className="whitespace-pre-wrap text-sm">{analysis.summary}</p>
          </section>

          {analysis.keyTerms.length > 0 && (
            <section aria-labelledby="contract-key-terms-heading">
              <h2
                id="contract-key-terms-heading"
                className="mb-1 font-semibold"
              >
                {t("keyTerms")}
              </h2>
              <ul className="text-sm">
                {analysis.keyTerms.map((k, i) => (
                  <li key={i}>
                    <span className="font-medium">{k.label}:</span> {k.value}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="contract-flags-heading">
            <h2 id="contract-flags-heading" className="mb-1 font-semibold">
              {t("flags")}
            </h2>
            {analysis.flaggedClauses.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {analysis.flaggedClauses.map((c, i) => (
                  <li
                    key={i}
                    className={`rounded-lg p-2 text-sm ${SEVERITY_STYLES[c.severity]}`}
                  >
                    <p className="text-xs font-semibold uppercase">
                      {t("severity")}: {t(SEVERITY_LABELS[c.severity])}
                    </p>
                    <p className="font-medium">{c.clause}</p>
                    <p>{c.concern}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg bg-neutral-100 p-3 text-sm text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
                {t("noFlags")}
              </p>
            )}
            <p className="mt-2 text-xs text-neutral-500">
              {t("analysisCaveat")}
            </p>
          </section>

          {hasSeriousConcern && (
            <Link
              href="/emergency"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-red-700 px-4 py-3 text-center font-semibold text-white"
            >
              {t("seriousCta")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
