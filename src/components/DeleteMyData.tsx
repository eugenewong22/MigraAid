"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export function DeleteMyData() {
  const t = useTranslations("privacy");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function remove() {
    if (state === "busy") return;
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
      // Focused on mount: it replaces the button the user just activated,
      // whose removal would otherwise drop focus to the page.
      <p
        className="text-[13px] text-saved-text focus:outline-none"
        role="status"
        tabIndex={-1}
        ref={(el) => el?.focus()}
      >
        {t("deleted")}
      </p>
    );
  }

  return (
    <div className="text-[13px]">
      {/* Guarded in the handler, not `disabled`: disabling the focused button
          while the request runs drops focus. */}
      <button
        type="button"
        onClick={remove}
        aria-disabled={state === "busy" || undefined}
        className={`inline-flex min-h-11 items-center text-muted underline transition-colors hover:text-body ${state === "busy" ? "opacity-50" : ""}`}
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
