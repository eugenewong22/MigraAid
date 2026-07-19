"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { StatusFocus } from "@/components/StatusFocus";
import { telHref } from "@/lib/referral/emergency";
import { sourceReferenceHref } from "@/lib/rag/source-link";

interface Citation {
  sourceRef: string;
  sourceUrl?: string;
  quote?: string;
  /** 1-based source number matching the [n] marker in the answer text. */
  sourceNumber?: number;
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
  const [liveMessage, setLiveMessage] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the user is reading the latest message (at/near the bottom).
  // Streaming appends many frames per second; force-scrolling on each one
  // would yank the user back down whenever they scroll up to re-read an
  // earlier answer (e.g. a phone number) mid-stream.
  const stickToBottom = useRef(true);

  useEffect(() => {
    const log = logRef.current;
    if (log && stickToBottom.current) log.scrollTop = log.scrollHeight;
  }, [messages]);

  function onLogScroll() {
    const log = logRef.current;
    if (!log) return;
    stickToBottom.current =
      log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  }

  useEffect(
    () => () => {
      if (announceTimer.current) clearTimeout(announceTimer.current);
    },
    [],
  );

  // Announce one message (loading, or the completed answer) through a single
  // polite live region, then clear it so screen-reader users don't re-read the
  // text while navigating the transcript. Streaming chunks are never announced.
  function announce(message: string) {
    setLiveMessage(message);
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setLiveMessage(""), 1200);
  }

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

  // A failed send must not cost the worker their typed question: re-typing a
  // long message on a flaky connection is a hard abandonment point. Restore it
  // to the composer unless they have already started typing something new.
  function restoreQuestion(question: string) {
    setInput((current) => (current.trim() ? current : question));
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || busy) return;

    setInput("");
    // Sending expresses intent to watch the new answer — resume auto-scroll
    // even if the user had scrolled up earlier.
    stickToBottom.current = true;
    setMessages((prev) => [
      ...prev,
      { role: "user", text: question },
      { role: "assistant", text: "" },
    ]);
    setBusy(true);
    // Keep focus in the composer: the Send button is about to disable, and a
    // disabled element silently drops keyboard/screen-reader focus to the page.
    inputRef.current?.focus();
    announce(t("loading"));

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
          let evt;
          try {
            evt = JSON.parse(line);
          } catch {
            // One malformed frame must not abort the rest of the stream.
            continue;
          }
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
            announce(evt.text);
          } else if (evt.type === "error") {
            completed = true;
            // Keep any partial answer already shown — replacing it with the
            // error wording deletes half-useful text on a flaky connection.
            updateLast((m) => ({ ...m, failed: true }));
            restoreQuestion(question);
            announce(t("error"));
          }
        }
      }
      if (!completed) throw new Error("incomplete response");
    } catch {
      updateLast((m) => ({ ...m, failed: true }));
      restoreQuestion(question);
      announce(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage}
      </p>

      <div className="flex flex-1 flex-col px-4 py-8 md:px-12 md:pt-9">
        <div className="mx-auto flex w-full max-w-[820px] flex-col gap-5">
          {/* Privacy note — sand strip at the top of the conversation. */}
          <p
            id="chat-privacy"
            className="rounded-xl bg-sand px-4 py-3 text-[13.5px] leading-[1.55] text-muted md:px-[18px]"
          >
            {t("privacy")}
          </p>

          <div
            ref={logRef}
            onScroll={onLogScroll}
            className="flex max-h-[58dvh] min-h-56 flex-col gap-5 overflow-y-auto overscroll-contain"
            role="log"
            aria-live="off"
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
                    ? "flex flex-col items-end gap-1.5"
                    : "flex flex-col items-start gap-1.5"
                }
              >
                {/* Speaker label above the bubble. */}
                <span
                  className={`text-[12.5px] font-bold uppercase leading-none tracking-[0.08em] ${
                    m.role === "user" ? "text-muted" : "text-terracotta"
                  }`}
                >
                  {m.role === "user"
                    ? t("speakerYou")
                    : t("speakerMigraAid")}
                </span>

                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-[18px_18px_4px_18px] bg-terracotta px-5 py-3.5 text-[17px] leading-[1.55] text-[#fff7ec] sm:max-w-[560px]"
                      : "flex max-w-[92%] flex-col gap-3.5 rounded-[18px_18px_18px_4px] border border-hairline bg-paper px-5 py-[18px] sm:max-w-[640px] md:px-6 md:py-5"
                  }
                >
                  <p
                    className={
                      m.role === "user"
                        ? "whitespace-pre-wrap"
                        : "whitespace-pre-wrap text-[17px] leading-[1.6] text-body"
                    }
                  >
                    {m.text ||
                      (busy && i === messages.length - 1 ? (
                        <span aria-hidden="true">…</span>
                      ) : (
                        ""
                      ))}
                  </p>

                  {m.failed && (
                    <p
                      role="alert"
                      className="text-[15px] leading-[1.45] text-emergency"
                    >
                      {t("error")}
                    </p>
                  )}

                  {m.escalated && (
                    <div className="rounded-[14px] border border-emergency-border bg-emergency-bg px-[18px] py-4 text-[15.5px] font-[600] leading-[1.5] text-emergency">
                      {t("escalatedNotice")}
                    </div>
                  )}

                  {m.referrals && m.referrals.length > 0 && (
                    <div className="flex flex-col gap-2.5 rounded-[14px] border border-warn-border bg-warn-bg px-[18px] py-4">
                      <p className="text-[12.5px] font-bold uppercase tracking-[0.08em] text-amber-deep">
                        {t("referral")}
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {m.referrals.map((r, k) => (
                          <p
                            key={k}
                            className="text-[15.5px] leading-[1.5] text-body-soft"
                          >
                            <strong className="font-[650] text-ink">
                              {r.org}
                            </strong>
                            {r.reason ? ` — ${r.reason}` : ""} ·{" "}
                            <a
                              href={r.href ?? telHref(r.contact)}
                              className="whitespace-nowrap text-body-soft underline underline-offset-2"
                            >
                              {r.contact}
                            </a>
                          </p>
                        ))}
                      </div>
                      {m.referralCode && (
                        <div className="flex flex-col gap-1 border-t border-warn-border pt-2.5">
                          <p
                            className="text-[13.5px] leading-[1.5] text-muted"
                            aria-label={`${t("referralCodeLabel")}: ${m.referralCode}`}
                          >
                            {t("referralCodeLabel")}:{" "}
                            <code className="select-all break-all font-mono font-[600] text-body-soft">
                              {m.referralCode}
                            </code>
                          </p>
                          <p className="text-[13.5px] leading-[1.5] text-muted">
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
                    <div className="flex flex-col gap-2 border-t border-hairline pt-3.5">
                      <p className="text-[12.5px] font-bold uppercase tracking-[0.08em] text-muted">
                        {t("sources")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {m.citations.map((c, j) => {
                          const href = sourceReferenceHref(
                            c.sourceUrl ?? c.sourceRef,
                          );
                          const label =
                            typeof c.sourceNumber === "number"
                              ? `[${c.sourceNumber}] ${c.sourceRef}`
                              : c.sourceRef;
                          return href ? (
                            <a
                              key={j}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-9 items-center rounded-full bg-sand px-3.5 text-[13.5px] font-[600] text-chip-text transition-colors hover:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                            >
                              {label}
                            </a>
                          ) : (
                            <span
                              key={j}
                              className="inline-flex min-h-9 items-center rounded-full bg-sand px-3.5 text-[13.5px] font-[600] text-chip-text"
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                      {m.citations.some((c) => c.quote) && (
                        <ul className="flex flex-col gap-1.5">
                          {m.citations.map((c, j) =>
                            c.quote ? (
                              <li key={j}>
                                <details>
                                  <summary className="cursor-pointer text-[13.5px] text-muted">
                                    {typeof c.sourceNumber === "number"
                                      ? `[${c.sourceNumber}] `
                                      : ""}
                                    {t("sourceExcerpt")}
                                  </summary>
                                  <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-sand-deep pl-3 text-[13.5px] italic text-body-soft">
                                    {c.quote}
                                  </blockquote>
                                </details>
                              </li>
                            ) : null,
                          )}
                        </ul>
                      )}
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
                      // Focused once on mount: it replaces the feedback button
                      // the user just activated, whose removal would drop focus.
                      <StatusFocus className="text-[13.5px] text-body-soft focus:outline-none">
                        {t("thanks")}
                      </StatusFocus>
                    ) : (
                      <div
                        className="flex items-center gap-2.5"
                        role="group"
                        aria-labelledby={"feedback-prompt-" + i}
                      >
                        <span
                          id={"feedback-prompt-" + i}
                          className="text-[14px] text-muted"
                        >
                          {t("helpful")}
                        </span>
                        {/* Guarded in the handler, not `disabled`: disabling the
                            focused button while the request runs drops focus. */}
                        <button
                          type="button"
                          onClick={() => {
                            if (m.feedbackPending) return;
                            sendFeedback(5, i, m.messageId!);
                          }}
                          aria-disabled={m.feedbackPending || undefined}
                          aria-label={t("feedbackYes")}
                          className={`inline-flex min-h-10 items-center rounded-full border-[1.5px] border-line px-[18px] text-[14px] font-[600] text-body transition-colors hover:bg-sand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${m.feedbackPending ? "opacity-50" : ""}`}
                        >
                          {t("feedbackYesShort")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (m.feedbackPending) return;
                            sendFeedback(1, i, m.messageId!);
                          }}
                          aria-disabled={m.feedbackPending || undefined}
                          aria-label={t("feedbackNo")}
                          className={`inline-flex min-h-10 items-center rounded-full border-[1.5px] border-line px-[18px] text-[14px] font-[600] text-body transition-colors hover:bg-sand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${m.feedbackPending ? "opacity-50" : ""}`}
                        >
                          {t("feedbackNoShort")}
                        </button>
                      </div>
                    ))}
                  {m.feedbackFailed && (
                    <p className="text-[13.5px] text-emergency" role="alert">
                      {t("feedbackError")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Composer — full-width bar on paper with a top hairline. */}
      <div className="border-t border-hairline bg-paper px-4 pb-5 pt-3.5 md:px-12 md:pb-[26px] md:pt-[18px]">
        <form
          onSubmit={send}
          className="mx-auto flex w-full max-w-[820px] gap-3"
          aria-busy={busy}
        >
          <label htmlFor="chat-question" className="sr-only">
            {t("questionLabel")}
          </label>
          {/* Never disabled: disabling the focused field on submit dumps focus
              to the page; send() ignores submissions while busy instead. */}
          <input
            id="chat-question"
            name="question"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("placeholder")}
            maxLength={1000}
            className="min-h-[52px] flex-1 rounded-full border-[1.5px] border-line bg-cream px-[18px] text-[17px] text-ink placeholder:text-muted focus-visible:border-terracotta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta md:min-h-[56px] md:px-6"
            aria-describedby="chat-privacy"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label={t("send")}
            className="grid min-h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-terracotta text-[#fff7ec] transition-colors hover:bg-terracotta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-50 md:inline-flex md:min-h-[56px] md:w-auto md:px-[30px]"
          >
            <span aria-hidden="true" className="text-[20px] md:hidden">
              ↑
            </span>
            <span className="hidden text-[17px] font-bold md:inline">
              {t("send")}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}
