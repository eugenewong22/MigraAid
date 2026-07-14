"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { telHref } from "@/lib/referral/emergency";

interface Citation {
  sourceRef: string;
  quote?: string;
}

interface Referral {
  org: string;
  contact: string;
  reason: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  escalated?: boolean;
  referrals?: Referral[];
}

export function Chat() {
  const t = useTranslations("chat");
  const locale = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  function updateLast(patch: (m: ChatMessage) => ChatMessage) {
    setMessages((prev) => {
      const copy = prev.slice();
      copy[copy.length - 1] = patch(copy[copy.length - 1]);
      return copy;
    });
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || busy) return;

    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", text: question },
      { role: "assistant", text: "" },
    ]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: question, locale }),
      });
      if (!res.ok || !res.body) throw new Error("request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.type === "text") {
            updateLast((m) => ({ ...m, text: m.text + evt.text }));
          } else if (evt.type === "done") {
            updateLast((m) => ({
              ...m,
              citations: evt.citations,
              escalated: evt.escalated,
              referrals: evt.referrals,
            }));
          } else if (evt.type === "error") {
            updateLast((m) => ({ ...m, text: t("error") }));
          }
        }
      }
    } catch {
      updateLast((m) => ({ ...m, text: t("error") }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-1 flex-col gap-4">
        {messages.length === 0 && (
          <p className="text-neutral-500">{t("empty")}</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "self-end rounded-2xl bg-blue-600 px-4 py-2 text-white"
                : "self-start rounded-2xl bg-neutral-100 px-4 py-2 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
            }
          >
            <p className="whitespace-pre-wrap">
              {m.text || (busy && i === messages.length - 1 ? "…" : "")}
            </p>
            {m.escalated && (
              <p className="mt-2 rounded-lg bg-amber-100 p-2 text-sm text-amber-900">
                {t("escalatedNotice")}
              </p>
            )}
            {m.referrals && m.referrals.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 p-2 text-sm">
                <p className="font-semibold">{t("referral")}</p>
                <ul className="mt-1 space-y-1">
                  {m.referrals.map((r, k) => (
                    <li key={k}>
                      {r.org} —{" "}
                      <a
                        href={telHref(r.contact)}
                        className="text-blue-600 underline"
                      >
                        {r.contact}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {m.citations && m.citations.length > 0 && (
              <div className="mt-2 text-xs text-neutral-500">
                <span className="font-semibold">{t("sources")}: </span>
                {m.citations.map((c, j) => (
                  <span key={j}>
                    {j > 0 ? ", " : ""}
                    {c.sourceRef}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={send} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("placeholder")}
          className="flex-1 rounded-xl border px-4 py-3 text-base"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {t("send")}
        </button>
      </form>
    </div>
  );
}
