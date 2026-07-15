"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { telHref } from "@/lib/referral/emergency";
import { sourceReferenceHref } from "@/lib/rag/source-link";

interface Citation {
  sourceRef: string;
  sourceUrl?: string;
  quote?: string;
}

interface Referral {
  org: string;
  contact: string;
  href?: string;
  reason: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  escalated?: boolean;
  referrals?: Referral[];
  referralCode?: string;
  referralExpiresAt?: string;
  messageId?: string;
  rated?: boolean;
  feedbackPending?: boolean;
  feedbackFailed?: boolean;
  failed?: boolean;
}

export function Chat() {
  const t = useTranslations("chat");
  const locale = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  function updateLast(patch: (m: ChatMessage) => ChatMessage) {
    setMessages((prev) => {
      const copy = prev.slice();
      copy[copy.length - 1] = patch(copy[copy.length - 1]);
      return copy;
    });
  }

  function updateMessage(
    index: number,
    patch: (m: ChatMessage) => ChatMessage,
  ) {
    setMessages((prev) =>
      prev.map((message, messageIndex) =>
        messageIndex === index ? patch(message) : message,
      ),
    );
  }

  async function sendFeedback(rating: number, index: number, messageId: string) {
    if (!conversationId) return;
    updateMessage(index, (m) => ({
      ...m,
      feedbackPending: true,
      feedbackFailed: false,
    }));
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating, conversationId, messageId }),
      });
      if (!response.ok) throw new Error("feedback failed");
      updateMessage(index, (m) => ({
        ...m,
        feedbackPending: false,
        rated: true,
      }));
    } catch {
      updateMessage(index, (m) => ({
        ...m,
        feedbackPending: false,
        feedbackFailed: true,
      }));
    }
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
        body: JSON.stringify({ message: question, locale, conversationId }),
      });
      if (!res.ok || !res.body) throw new Error("request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

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
            completed = true;
            if (evt.conversationId) setConversationId(evt.conversationId);
            updateLast((m) => ({
              ...m,
              text: evt.text,
              messageId: evt.messageId,
              citations: evt.citations,
              escalated: evt.escalated,
              referrals: evt.referrals,
              referralCode: evt.referralCode,
              referralExpiresAt: evt.referralExpiresAt,
            }));
          } else if (evt.type === "error") {
            completed = true;
            updateLast((m) => ({ ...m, text: t("error"), failed: true }));
          }
        }
      }
      if (!completed) throw new Error("incomplete response");
    } catch {
      updateLast((m) => ({ ...m, text: t("error"), failed: true }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        ref={logRef}
        className="flex min-h-64 max-h-[60dvh] flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pr-1"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={busy}
      >
        {messages.length === 0 && (
          <p className="text-neutral-500">{t("empty")}</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            role="article"
            aria-label={
              m.role === "user" ? t("speakerYou") : t("speakerMigraAid")
            }
            className={
              m.role === "user"
                ? "self-end rounded-2xl bg-blue-600 px-4 py-2 text-white"
                : "self-start rounded-2xl bg-neutral-100 px-4 py-2 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
            }
          >
            <p
              className="whitespace-pre-wrap"
              role={m.failed ? "alert" : undefined}
            >
              {m.text ||
                (busy && i === messages.length - 1 ? (
                  <>
                    <span aria-hidden="true">…</span>
                    <span className="sr-only">{t("loading")}</span>
                  </>
                ) : (
                  ""
                ))}
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
                        href={r.href ?? telHref(r.contact)}
                        className="inline-flex min-h-11 items-center text-blue-600 underline"
                      >
                        {r.contact}
                      </a>
                    </li>
                  ))}
                </ul>
                {m.referralCode && (
                  <div className="mt-3 rounded-lg bg-white/70 p-2 text-neutral-900">
                    <p className="font-semibold">{t("referralCodeLabel")}</p>
                    <code
                      className="my-1 block select-all break-all rounded border bg-white px-3 py-2 text-center text-lg font-bold tracking-wider"
                      aria-label={`${t("referralCodeLabel")}: ${m.referralCode}`}
                    >
                      {m.referralCode}
                    </code>
                    <p className="text-xs">
                      {m.referralExpiresAt
                        ? t("referralCodeHelp", {
                            date: new Intl.DateTimeFormat(locale, {
                              dateStyle: "medium",
                            }).format(new Date(m.referralExpiresAt)),
                          })
                        : t("referralCodeHelpNoDate")}
                    </p>
                  </div>
                )}
              </div>
            )}
            {m.citations && m.citations.length > 0 && (
              <div className="mt-2 text-xs text-neutral-500">
                <p className="font-semibold">{t("sources")}</p>
                <ul className="mt-1 list-inside list-disc space-y-2">
                  {m.citations.map((c, j) => {
                    const href = sourceReferenceHref(c.sourceUrl ?? c.sourceRef);
                    return (
                      <li key={j}>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-blue-600 underline"
                          >
                            {c.sourceRef}
                          </a>
                        ) : (
                          <span>{c.sourceRef}</span>
                        )}
                        {c.quote && (
                          <details className="mt-1">
                            <summary className="cursor-pointer font-medium text-blue-600 underline">
                              {t("sourceExcerpt")}
                            </summary>
                            <blockquote className="mt-1 whitespace-pre-wrap border-l-2 pl-2 italic">
                              {c.quote}
                            </blockquote>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {m.role === "assistant" &&
              m.text &&
              !m.failed &&
              conversationId &&
              m.messageId &&
              i === messages.length - 1 &&
              !busy &&
              (m.rated ? (
                <p className="mt-2 text-xs text-neutral-500" role="status">
                  {t("thanks")}
                </p>
              ) : (
                <div
                  className="mt-2 flex items-center gap-2 text-sm"
                  role="group"
                  aria-labelledby={"feedback-prompt-" + i}
                >
                  <span
                    id={"feedback-prompt-" + i}
                    className="text-neutral-500"
                  >
                    {t("helpful")}
                  </span>
                  <button
                    type="button"
                    onClick={() => sendFeedback(5, i, m.messageId!)}
                    disabled={m.feedbackPending}
                    aria-label={t("feedbackYes")}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 dark:hover:bg-neutral-700"
                  >
                    👍
                  </button>
                  <button
                    type="button"
                    onClick={() => sendFeedback(1, i, m.messageId!)}
                    disabled={m.feedbackPending}
                    aria-label={t("feedbackNo")}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 dark:hover:bg-neutral-700"
                  >
                    👎
                  </button>
                </div>
              ))}
            {m.feedbackFailed && (
              <p className="mt-2 text-xs text-red-600" role="alert">
                {t("feedbackError")}
              </p>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={send} className="flex gap-2" aria-busy={busy}>
        <label htmlFor="chat-question" className="sr-only">
          {t("questionLabel")}
        </label>
        <input
          id="chat-question"
          name="question"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("placeholder")}
          maxLength={1000}
          className="flex-1 rounded-xl border px-4 py-3 text-base"
          disabled={busy}
          aria-describedby="chat-privacy"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {t("send")}
        </button>
      </form>
      <p id="chat-privacy" className="text-xs text-neutral-500">
        {t("privacy")}
      </p>
    </div>
  );
}
