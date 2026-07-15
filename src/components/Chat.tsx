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
    <div className="flex flex-1 flex-col gap-6 py-9">
      <div
        ref={logRef}
        className="mx-auto flex w-full max-w-[860px] flex-1 flex-col gap-5"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={busy}
      >
        {messages.length === 0 && (
          <p className="text-[16.5px] text-muted">{t("empty")}</p>
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
                ? "max-w-[70%] self-end rounded-[18px_18px_4px_18px] bg-navy px-5 py-3.5 text-[17px] leading-[1.5] text-white"
                : "flex max-w-[82%] flex-col gap-3.5 self-start rounded-[18px_18px_18px_4px] bg-surface px-[22px] py-[18px]"
            }
          >
            <p
              className={
                m.role === "user"
                  ? "whitespace-pre-wrap"
                  : "whitespace-pre-wrap text-[17px] leading-[1.55] text-ink"
              }
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
              <div className="rounded-[10px] bg-warn-bg px-3.5 py-2.5 text-[15px] leading-[1.45] text-warn-text">
                <span aria-hidden="true">⚠ </span>
                {t("escalatedNotice")}
              </div>
            )}

            {m.referrals && m.referrals.length > 0 && (
              <div className="flex flex-col gap-2.5 rounded-[12px] border border-referral-border bg-referral-bg p-4">
                <p className="text-[15px] font-bold text-ink">{t("referral")}</p>
                <div className="flex flex-col gap-1.5">
                  {m.referrals.map((r, k) => (
                    <div
                      key={k}
                      className="flex min-h-11 items-center gap-2 text-[16px] text-body"
                    >
                      {r.org} —{" "}
                      <a
                        href={r.href ?? telHref(r.contact)}
                        className="font-[650] text-navy underline"
                      >
                        {r.contact}
                      </a>
                    </div>
                  ))}
                </div>
                {m.referralCode && (
                  <div className="flex flex-col gap-1.5 rounded-[10px] border border-hairline bg-white p-3.5">
                    <p className="text-[14px] font-bold text-ink">
                      {t("referralCodeLabel")}
                    </p>
                    <code
                      className="block select-all break-all rounded-[8px] border border-dashed border-sky-faint bg-[#f6f8fc] px-3 py-2.5 text-center text-[22px] font-extrabold tracking-[0.12em] text-navy"
                      aria-label={`${t("referralCodeLabel")}: ${m.referralCode}`}
                    >
                      {m.referralCode}
                    </code>
                    <p className="text-[13px] text-muted">
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
              <div className="flex flex-col gap-2 border-t border-hairline pt-3">
                <p className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted">
                  {t("sources")}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {m.citations.map((c, j) => {
                    const href = sourceReferenceHref(c.sourceUrl ?? c.sourceRef);
                    return (
                      <li key={j} className="flex flex-col gap-1">
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="break-words text-[14.5px] text-navy underline"
                          >
                            {c.sourceRef}
                          </a>
                        ) : (
                          <span className="text-[14.5px] text-body">
                            {c.sourceRef}
                          </span>
                        )}
                        {c.quote && (
                          <details>
                            <summary className="cursor-pointer text-[13.5px] text-muted">
                              {t("sourceExcerpt")}
                            </summary>
                            <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-hairline pl-3 text-[13.5px] italic text-body-soft">
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
                <p className="text-[13px] text-muted" role="status">
                  {t("thanks")}
                </p>
              ) : (
                <div
                  className="flex items-center gap-2.5"
                  role="group"
                  aria-labelledby={"feedback-prompt-" + i}
                >
                  <span
                    id={"feedback-prompt-" + i}
                    className="text-[14.5px] text-muted"
                  >
                    {t("helpful")}
                  </span>
                  <button
                    type="button"
                    onClick={() => sendFeedback(5, i, m.messageId!)}
                    disabled={m.feedbackPending}
                    aria-label={t("feedbackYes")}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] border border-hairline bg-white text-[18px] transition-colors hover:bg-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky disabled:opacity-50"
                  >
                    👍
                  </button>
                  <button
                    type="button"
                    onClick={() => sendFeedback(1, i, m.messageId!)}
                    disabled={m.feedbackPending}
                    aria-label={t("feedbackNo")}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] border border-hairline bg-white text-[18px] transition-colors hover:bg-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky disabled:opacity-50"
                  >
                    👎
                  </button>
                </div>
              ))}
            {m.feedbackFailed && (
              <p className="text-[13px] text-emergency" role="alert">
                {t("feedbackError")}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-2.5">
        <form onSubmit={send} className="flex gap-3" aria-busy={busy}>
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
            className="min-h-[52px] flex-1 rounded-[12px] border-[1.5px] border-input px-[18px] text-[17px] text-ink placeholder:text-muted focus-visible:border-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky"
            disabled={busy}
            aria-describedby="chat-privacy"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="min-h-[52px] rounded-[12px] bg-navy px-7 text-[17px] font-bold text-white transition-colors hover:bg-navy-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {t("send")}
          </button>
        </form>
        <p id="chat-privacy" className="text-[13px] leading-[1.5] text-muted">
          {t("privacy")}
        </p>
      </div>
    </div>
  );
}
