"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { StatusFocus } from "@/components/StatusFocus";
import { telHref } from "@/lib/referral/emergency";
import { sourceReferenceHref } from "@/lib/rag/source-link";

/**
 * Compact chip text: a URL source reference renders as its host (e.g.
 * "mom.gov.sg") so a 50+-char link can't blow out the chat layout on a phone;
 * a human-readable reference ("MOM — Employer guidelines") is shown as-is. The
 * full reference remains the link's accessible name and target.
 */
function sourceChipLabel(ref: string): string {
  try {
    return new URL(ref).hostname.replace(/^www\./, "");
  } catch {
    return ref;
  }
}

interface Citation {
  sourceRef: string;
  sourceUrl?: string;
  quote?: string;
  /** 1-based source number matching the [n] marker in the answer text. */
  sourceNumber?: number;
}

interface Referral {
  orgKey?: string;
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
  /** Overrides the generic error copy shown for `failed` (e.g. rate limiting). */
  failedMessage?: string;
}

/** Distinguishes an HTTP 429 from other send failures so the UI can show
 * "please wait" guidance instead of the generic error message. */
class RateLimitedError extends Error {
  constructor() {
    super("rate limited");
    this.name = "RateLimitedError";
  }
}

/**
 * How far along the bar should sit.
 *
 * Capped at 90% while writing so it never claims to be done, and given floors
 * per stage so it always moves forward. `chars` is the honest signal: it says
 * how much has been written without revealing any of it, which leaves the
 * citation gate — the reason for buffering at all — completely intact.
 */
export function progressPercent(stage: string | null, chars: number): number {
  if (stage === "checking") return 95;
  if (stage === "writing") {
    // ~900 characters is a typical full answer.
    return Math.min(90, 35 + Math.round((chars / 900) * 55));
  }
  if (stage === "reading") return 25;
  return 10;
}

export function Chat() {
  const t = useTranslations("chat");
  // Referral org names/notes reuse the professionally-translated emergency
  // contact catalog (all 8 locales) rather than the English strings the API
  // sends, so the "who can help" card isn't English at the moment of escalation.
  const te = useTranslations("emergency");
  const locale = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** Where the server says it is, so the wait is legible rather than blank. */
  const [stage, setStage] = useState<string | null>(null);
  const [writtenChars, setWrittenChars] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  /** Localized label for a server stage. Unknown stages fall back to the
   *  generic loading copy rather than rendering nothing. */
  const stageLabel = (value: string | null): string => {
    switch (value) {
      case "searching":
        return t("statusSearching");
      case "reading":
        return t("statusReading");
      case "writing":
        return t("statusWriting");
      case "checking":
        return t("statusChecking");
      default:
        return t("loading");
    }
  };

  /** Stop the turn. The server aborts generation on the request signal, so
   *  this genuinely halts the spend rather than just hiding the result. */
  const cancel = () => {
    abortRef.current?.abort();
  };
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
  // The hold scales with length: clearing a long answer after a flat 1.2s
  // mutated the region mid-utterance and truncated it on some AT engines.
  function announce(message: string, holdMs = 1200) {
    setLiveMessage(message);
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setLiveMessage(""), holdMs);
  }

  /** ~200 wpm reading ≈ 55ms/char; clamp so the region clears eventually. */
  function announceHoldMs(text: string) {
    return Math.min(30_000, Math.max(1_200, text.length * 55));
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

  // Elapsed seconds, for the visible counter only. A wait of 30-55s with no
  // moving indicator is indistinguishable from a hang.
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1_000,
    );
    return () => clearInterval(id);
  }, [startedAt]);

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
    setStage("searching");
    setWrittenChars(0);
    setStartedAt(Date.now());
    setElapsed(0);
    // Keep focus in the composer: the Send button is about to disable, and a
    // disabled element silently drops keyboard/screen-reader focus to the page.
    inputRef.current?.focus();
    announce(t("loading"));

    // A cellular/Wi-Fi handoff can drop the socket without a FIN, leaving
    // `fetch`/`read()` pending forever — which would strand the composer with
    // Send disabled and no way to retry but a reload (losing the question).
    // Guard with both an overall ceiling and a per-chunk inactivity timer; the
    // server emits heartbeat frames during generation so a healthy slow answer
    // keeps the inactivity timer alive while a dead connection trips it.
    const controller = new AbortController();
    abortRef.current = controller;
    const OVERALL_TIMEOUT_MS = 75_000;
    const INACTIVITY_TIMEOUT_MS = 25_000;
    const overallTimer = setTimeout(() => controller.abort(), OVERALL_TIMEOUT_MS);
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    const resetInactivity = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => controller.abort(), INACTIVITY_TIMEOUT_MS);
    };

    try {
      resetInactivity();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: question, locale, conversationId }),
        signal: controller.signal,
      });
      // The server sends a `retry-after` header on 429, but a generic error
      // gives the worker no "please wait" guidance — surface it distinctly
      // (mirrors contract upload's 429 -> errorRateLimited mapping).
      if (res.status === 429) throw new RateLimitedError();
      if (!res.ok || !res.body) throw new Error("request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        resetInactivity();
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
          if (evt.type === "status") {
            // Announce each stage once. The elapsed counter below is visual
            // only — reading seconds aloud to a screen-reader user is torture.
            setStage(evt.stage);
            const label = stageLabel(evt.stage);
            if (label) announce(label);
          } else if (evt.type === "progress") {
            setWrittenChars(typeof evt.chars === "number" ? evt.chars : 0);
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
            announce(evt.text, announceHoldMs(evt.text));
          } else if (evt.type === "error") {
            completed = true;
            if (evt.reason === "busy") {
              updateLast((m) => ({ ...m, failed: true, failedMessage: t("errorBusy") }));
              restoreQuestion(question);
              announce(t("errorBusy"));
              continue;
            }
            // Keep any partial answer already shown — replacing it with the
            // error wording deletes half-useful text on a flaky connection.
            updateLast((m) => ({ ...m, failed: true }));
            restoreQuestion(question);
            announce(t("error"));
          }
        }
      }
      if (!completed) throw new Error("incomplete response");
    } catch (err) {
      const message = err instanceof RateLimitedError ? t("errorRateLimited") : t("error");
      updateLast((m) => ({ ...m, failed: true, failedMessage: message }));
      restoreQuestion(question);
      announce(message);
    } finally {
      clearTimeout(overallTimer);
      clearTimeout(inactivityTimer);
      setBusy(false);
      setStage(null);
      setStartedAt(null);
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
            className="chat-log-maxh flex min-h-56 flex-col gap-5 overflow-y-auto overscroll-contain"
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
                        ? "whitespace-pre-wrap [overflow-wrap:anywhere]"
                        : "whitespace-pre-wrap [overflow-wrap:anywhere] text-[17px] leading-[1.6] text-body"
                    }
                  >
                    {m.text ||
                      (busy && i === messages.length - 1 ? (
                        <span aria-hidden="true">…</span>
                      ) : (
                        ""
                      ))}
                  </p>

                  {busy && !m.text && i === messages.length - 1 && (
                    <div className="flex flex-col gap-2">
                      {/* Stage in a polite region, announced once per change.
                          The counter is aria-hidden: reading seconds aloud to a
                          screen-reader user would be relentless. */}
                      <div className="flex items-center justify-between gap-3">
                        <span role="status" className="text-[14px] text-muted">
                          {stageLabel(stage)}
                        </span>
                        <span aria-hidden="true" className="text-[13px] tabular-nums text-muted">
                          {elapsed}s
                        </span>
                      </div>
                      {/* Capped below full so it never claims to be finished.
                          The width is driven by characters actually written —
                          honest about how much, silent about what. */}
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-sand"
                        role="progressbar"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full rounded-full bg-terracotta transition-[width] duration-500"
                          style={{ width: `${progressPercent(stage, writtenChars)}%` }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={cancel}
                        className="self-start min-h-11 rounded-lg px-3 text-[14px] font-semibold text-muted underline underline-offset-4"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  )}

                  {m.failed && (
                    <p
                      role="alert"
                      className="text-[15px] leading-[1.45] text-emergency"
                    >
                      {m.failedMessage ?? t("error")}
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
                        {m.referrals.map((r, k) => {
                          // Prefer the localized emergency-catalog name/note;
                          // fall back to the API's English name for orgs (only
                          // TADM) not present there.
                          const hasLocalized =
                            !!r.orgKey && te.has(`contacts.${r.orgKey}.name`);
                          const orgName = hasLocalized
                            ? te(`contacts.${r.orgKey}.name`)
                            : r.org;
                          const note =
                            hasLocalized && te.has(`contacts.${r.orgKey}.note`)
                              ? te(`contacts.${r.orgKey}.note`)
                              : null;
                          // Language-neutral link text: a bare hostname for web
                          // links, the dialable number for phone contacts — no
                          // English action label to leave untranslated.
                          const linkLabel = r.href
                            ? sourceChipLabel(r.href)
                            : r.contact;
                          return (
                            <p
                              key={k}
                              className="text-[15.5px] leading-[1.5] text-body-soft"
                            >
                              <strong className="font-[650] text-ink">
                                {orgName}
                              </strong>
                              {note ? ` — ${note}` : ""} ·{" "}
                              <a
                                href={r.href ?? telHref(r.contact)}
                                className="whitespace-nowrap text-body-soft underline underline-offset-2"
                              >
                                {linkLabel}
                              </a>
                            </p>
                          );
                        })}
                      </div>
                      {m.referralCode && (
                        <div className="flex flex-col gap-1 border-t border-warn-border pt-2.5">
                          <p className="text-[13.5px] leading-[1.5] text-muted">
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
                          const prefix =
                            typeof c.sourceNumber === "number"
                              ? `[${c.sourceNumber}] `
                              : "";
                          const fullLabel = `${prefix}${c.sourceRef}`;
                          const shownLabel = `${prefix}${sourceChipLabel(c.sourceRef)}`;
                          return href ? (
                            <a
                              key={j}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={fullLabel}
                              className="inline-flex min-h-11 max-w-full items-center rounded-full bg-sand px-3.5 text-[13.5px] font-[600] text-chip-text [overflow-wrap:anywhere] transition-colors hover:bg-sand-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                            >
                              {shownLabel}
                            </a>
                          ) : (
                            <span
                              key={j}
                              className="inline-flex min-h-11 max-w-full items-center rounded-full bg-sand px-3.5 text-[13.5px] font-[600] text-chip-text [overflow-wrap:anywhere]"
                            >
                              {shownLabel}
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
                                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13.5px] text-muted">
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
