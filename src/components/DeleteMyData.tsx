"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export function DeleteMyData() {
  const t = useTranslations("privacy");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function remove() {
    if (!window.confirm(t("confirm"))) return;
    setState("busy");
    try {
      const response = await fetch("/api/privacy", { method: "DELETE" });
      if (!response.ok) throw new Error("delete failed");
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className="text-[13px] text-saved-text" role="status">
        {t("deleted")}
      </p>
    );
  }

  return (
    <div className="text-[13px]">
      <button
        type="button"
        onClick={remove}
        disabled={state === "busy"}
        className="inline-flex min-h-11 items-center text-muted underline transition-colors hover:text-body disabled:opacity-50"
      >
        {state === "busy" ? t("deleting") : t("delete")}
      </button>
      {state === "error" && (
        <p className="mt-1 text-emergency" role="alert">
          {t("error")}
        </p>
      )}
    </div>
  );
}
