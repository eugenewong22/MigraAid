"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

interface FlaggedClause {
  clause: string;
  concern: string;
  severity: "info" | "warning" | "serious";
}

interface Analysis {
  summary: string;
  keyTerms: { label: string; value: string }[];
  flaggedClauses: FlaggedClause[];
}

const SEVERITY_STYLES: Record<FlaggedClause["severity"], string> = {
  info: "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100",
  warning: "bg-amber-100 text-amber-900",
  serious: "bg-red-100 text-red-900",
};

export function ContractUpload() {
  const t = useTranslations("contract");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setAnalysis(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("locale", locale);
      const res = await fetch("/api/contract", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setAnalysis(data as Analysis);
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="cursor-pointer rounded-xl bg-blue-600 px-5 py-4 text-center text-lg font-semibold text-white">
        {busy ? t("analyzing") : t("upload")}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFile}
          className="hidden"
          disabled={busy}
        />
      </label>
      <p className="text-xs text-neutral-500">{t("privacy")}</p>
      {error && <p className="text-red-600">{error}</p>}

      {analysis && (
        <div className="flex flex-col gap-4">
          <section>
            <h2 className="mb-1 font-semibold">{t("summary")}</h2>
            <p className="whitespace-pre-wrap text-sm">{analysis.summary}</p>
          </section>

          {analysis.keyTerms.length > 0 && (
            <section>
              <h2 className="mb-1 font-semibold">{t("keyTerms")}</h2>
              <ul className="text-sm">
                {analysis.keyTerms.map((k, i) => (
                  <li key={i}>
                    <span className="font-medium">{k.label}:</span> {k.value}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {analysis.flaggedClauses.length > 0 && (
            <section>
              <h2 className="mb-1 font-semibold">{t("flags")}</h2>
              <ul className="flex flex-col gap-2">
                {analysis.flaggedClauses.map((c, i) => (
                  <li
                    key={i}
                    className={`rounded-lg p-2 text-sm ${SEVERITY_STYLES[c.severity]}`}
                  >
                    <p className="font-medium">{c.clause}</p>
                    <p>{c.concern}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
