/**
 * The three canned safety responses, read from the message catalogs.
 *
 * These are the highest-stakes strings in the product — the crisis referral a
 * worker sees when they may be in danger, the refusal when nothing verified
 * covers their question, and the reply to an instruction-injection attempt.
 * They used to live as inline maps in `answer.ts`, which meant the one part of
 * the UI nobody could afford to have drift was the one part
 * `tests/catalogs.test.ts` did not cover.
 *
 * Read straight from `messages/*.json` rather than generated into a separate
 * file: one source of truth, no build step to forget, and the catalog parity
 * test now guards them automatically.
 *
 * next-intl's `getTranslations` is not usable here — this module is called from
 * `scripts/eval/run.ts` and from streaming code with no request context — so
 * the catalogs are imported directly.
 */
import bn from "../../../messages/bn.json";
import en from "../../../messages/en.json";
import id from "../../../messages/id.json";
import my from "../../../messages/my.json";
import ta from "../../../messages/ta.json";
import th from "../../../messages/th.json";
import tl from "../../../messages/tl.json";
import zh from "../../../messages/zh.json";

type SafetyCopy = { ungrounded: string; highStakes: string; injection: string };

const CATALOGS: Record<string, { safety: SafetyCopy }> = {
  bn, en, id, my, ta, th, tl, zh,
};

/** Falls back to English for an unrecognised locale rather than rendering nothing. */
export function safetyResponse(
  locale: string,
  kind: keyof SafetyCopy,
): string {
  return (CATALOGS[locale] ?? CATALOGS.en).safety[kind];
}
