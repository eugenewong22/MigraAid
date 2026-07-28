import type { RetrievedChunk } from "@/lib/rag/types";
import type { EscalationTrigger } from "./prompt";

const HIGH_STAKES: Array<[EscalationTrigger, string[]]> = [
  ["unpaid_salary", ["unpaid salary", "salary not paid", "not been paid", "withheld my pay", "欠薪", "工资没发", "gaji belum dibayar", "hindi binayaran", "சம்பளம் கிடைக்கவில்லை", "বেতন দেয়নি", "ไม่จ่ายเงินเดือน", "လစာမပေး"]],
  ["workplace_injury", ["workplace injury", "injured at work", "hurt at work", "work accident", "工伤", "kecelakaan kerja", "nasugatan sa trabaho", "வேலை விபத்து", "কাজে আহত", "อุบัติเหตุจากงาน", "အလုပ်ခွင်ထိခိုက်"]],
  ["wrongful_dismissal", ["wrongful dismissal", "unfair dismissal", "fired me", "dismissed me", "terminated me", "被解雇", "dipecat", "tinanggal sa trabaho", "வேலையிலிருந்து நீக்க", "চাকরি থেকে বরখাস্ত", "ถูกไล่ออก", "အလုပ်ထုတ်"]],
  ["contract_dispute", ["contract dispute", "forced me to sign", "contract was changed", "合同纠纷", "sengketa kontrak", "alitan sa kontrata", "ஒப்பந்த தகராறு", "চুক্তি বিরোধ", "ข้อพิพาทสัญญา", "စာချုပ်အငြင်းပွား"]],
  ["abuse_or_threats", ["threatened me", "threatening me", "hit me", "abused me", "locked me", "took my passport", "威胁我", "虐待", "mengancam saya", "inaabuso", "அச்சுறுத்த", "নির্যাতন", "ข่มขู่", "ခြိမ်းခြောက်"]],
  ["repatriation", ["repatriat", "send me home", "sent me home", "forced to leave singapore", "遣返", "dipulangkan paksa", "pauwiin", "நாட்டுக்கு திருப்ப", "দেশে ফেরত পাঠ", "ส่งกลับประเทศ", "နေရပ်ပြန်ပို့"]],
  ["immigration_status", ["immigration status", "work permit cancelled", "work permit expired", "overstay", "准证被取消", "izin kerja dibatalkan", "kinansela ang work permit", "வேலை அனுமதி ரத்து", "ওয়ার্ক পারমিট বাতিল", "ใบอนุญาตทำงานถูกยกเลิก", "အလုပ်ပါမစ်ပယ်ဖျက်"]],
];

/** Deterministic backstop: high-stakes routing must not depend on a tool call. */
export function detectHighStakesIssue(text: string): EscalationTrigger | undefined {
  const normalized = text.toLowerCase();
  return HIGH_STAKES.find(([, phrases]) =>
    phrases.some((phrase) => normalized.includes(phrase)),
  )?.[0];
}


/**
 * How hard an escalation should bite.
 *
 * Escalation used to be one thing, and that one thing *deleted the answer*:
 * any matched phrase replaced the model's prose with canned crisis text. The
 * trigger categories cover most of what the corpus is about, so a false
 * positive meant a worker asking about salary or dismissal got no information
 * at all. That is why the phrase lists had to stay narrow, and why recall could
 * never be tuned up.
 *
 * Splitting the consequence lets the matcher be generous:
 *
 *   danger    a worker may be unsafe right now. Suppress the answer, show the
 *             reviewed crisis wording, lead with emergency contacts. Precision
 *             matters here; the list stays tight.
 *   assisted  serious, but the worker still benefits from knowing the rule.
 *             Answer normally — grounded and cited as always — then attach the
 *             warning and the referral. A false positive costs one extra
 *             banner, not the whole answer.
 */
export type EscalationSeverity = "danger" | "assisted";

/**
 * Only immediate-harm categories suppress the answer. Passport confiscation,
 * confinement and threats all live in `abuse_or_threats`.
 */
const DANGER_TRIGGERS: ReadonlySet<string> = new Set(["abuse_or_threats"]);

export function escalationSeverity(trigger: string): EscalationSeverity {
  return DANGER_TRIGGERS.has(trigger) ? "danger" : "assisted";
}

const INJECTION_PATTERNS = [
  /ignore (?:all |any |the )?(?:previous|prior|system|developer) instructions?/i,
  /disregard (?:all |any |the )?(?:previous|prior|system|developer) (?:instructions?|rules?)/i,
  /(?:reveal|show|print|repeat|leak) (?:your |the )?(?:system prompt|developer message|hidden instructions?)/i,
  /(?:system prompt|developer message).{0,40}(?:secret|verbatim|exact)/i,
  /(?:jailbreak|developer mode|do anything now|\bDAN\b)/i,
  /follow (?:the )?instructions? (?:inside|in) (?:the )?(?:document|source|contract|context)/i,
];

/** Reject explicit instruction-hierarchy attacks before retrieval/generation. */
export function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export const DEFAULT_MIN_RETRIEVAL_SCORE = 0.35;

/** A generation is allowed only when at least one retrieved source is credible. */
export function hasCredibleGrounding(
  chunks: RetrievedChunk[],
  minScore?: number,
): boolean {
  // `??` alone does not catch an empty-string env var (Number("") === 0), which
  // would silently disable the grounding gate (every non-negative cosine score
  // passes). Require a finite, strictly-positive threshold or fall back to the
  // safe default.
  const configured = minScore ?? Number(process.env.RAG_MIN_SCORE);
  const threshold =
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_MIN_RETRIEVAL_SCORE;
  return chunks.some((chunk) => chunk.score >= threshold);
}
