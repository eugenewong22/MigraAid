/**
 * The ceiling on inference spend.
 *
 * Cost is incurred *before* it can be counted, so a counter alone cannot bound
 * anything — between the check and the charge, any number of requests can be in
 * flight. Three mechanisms together bound the overshoot:
 *
 *   1. Reserve pessimistically, reconcile actually. Charge the worst case
 *      before the call and refund the difference after. A lambda that dies
 *      mid-request then over-counts rather than under-counts, which is the safe
 *      direction to be wrong in.
 *   2. A global concurrency cap, so the number of unreconciled requests is
 *      bounded and the maximum overshoot is `cap × worst-case request`.
 *   3. A global rate limit, because a per-IP limit is not a limit at all
 *      against a botnet with ten thousand addresses.
 *
 * Money is tracked in integer micro-dollars: `daily_metrics.value` is an
 * integer column, and floating-point accumulation across thousands of small
 * increments is not something to debug at 3am.
 */

/** One US dollar, in the integer unit this module counts in. */
export const MICROS_PER_USD = 1_000_000;

export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD);
}

export function microsToUsd(micros: number): number {
  return micros / MICROS_PER_USD;
}

/**
 * Price per million tokens, in micro-dollars.
 *
 * Deliberately a static table rather than a provider lookup: it only has to be
 * approximately right to enforce a ceiling, and a wrong-but-conservative number
 * fails safe. Review when changing model.
 */
export interface ModelPricing {
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
}

export const DEFAULT_PRICING: ModelPricing = {
  inputMicrosPerMillion: 2_500_000,
  outputMicrosPerMillion: 10_000_000,
};

export function estimateCostMicros(
  usage: { inputTokens: number; outputTokens: number },
  pricing: ModelPricing = DEFAULT_PRICING,
): number {
  const input = (usage.inputTokens / 1_000_000) * pricing.inputMicrosPerMillion;
  const output = (usage.outputTokens / 1_000_000) * pricing.outputMicrosPerMillion;
  return Math.ceil(input + output);
}

/**
 * What to charge before a call, when the output length is not yet known.
 * Assumes the full output budget is used, so the reservation is never an
 * under-estimate.
 */
export function reservationMicros(
  input: { inputTokens: number; maxOutputTokens: number },
  pricing: ModelPricing = DEFAULT_PRICING,
): number {
  return estimateCostMicros(
    { inputTokens: input.inputTokens, outputTokens: input.maxOutputTokens },
    pricing,
  );
}

export const BUDGET_STATES = ["ok", "soft", "hard", "panic"] as const;
export type BudgetState = (typeof BUDGET_STATES)[number];

/** Fractions of the daily ceiling at which each state begins. */
export const SOFT_THRESHOLD = 0.7;
export const PANIC_THRESHOLD = 1.5;

export interface BudgetStatus {
  state: BudgetState;
  spentMicros: number;
  ceilingMicros: number;
  /** 0–1+, for the admin dashboard and the alert body. */
  fraction: number;
  /** Should the app degrade itself on this alone? */
  degrade: boolean;
  /** Should the expensive vision route stop, short of full degradation? */
  contractDisabled: boolean;
}

/**
 * Classify current spend.
 *
 * `soft` turns off the contract explainer first: it is by far the most
 * expensive call per request, and losing it while chat survives is a better
 * trade for a worker than the reverse.
 */
export function budgetStatus(input: {
  spentMicros: number;
  ceilingUsd: number;
  overridden?: boolean;
}): BudgetStatus {
  const ceilingMicros = usdToMicros(input.ceilingUsd);
  const spentMicros = Math.max(0, input.spentMicros);
  const fraction = ceilingMicros > 0 ? spentMicros / ceilingMicros : 0;

  if (input.overridden) {
    return {
      state: "ok",
      spentMicros,
      ceilingMicros,
      fraction,
      degrade: false,
      contractDisabled: false,
    };
  }

  const state: BudgetState =
    fraction >= PANIC_THRESHOLD
      ? "panic"
      : fraction >= 1
        ? "hard"
        : fraction >= SOFT_THRESHOLD
          ? "soft"
          : "ok";

  return {
    state,
    spentMicros,
    ceilingMicros,
    fraction,
    degrade: state === "hard" || state === "panic",
    contractDisabled: state !== "ok",
  };
}

/**
 * The Redis key holding today's spend.
 *
 * Keyed on the SGT calendar day used everywhere else in this codebase, so the
 * ceiling resets at local midnight for the audience rather than at UTC — and it
 * expires on its own, so there is no reset job to fail silently.
 */
export function spendKey(day: string): string {
  return `migraaid:spend:${day}`;
}

export function inflightKey(): string {
  return "migraaid:inflight";
}

/** Ceiling in effect, preferring a manual flag override over the env default. */
export function effectiveCeilingUsd(
  flagOverrideUsd: number | undefined,
  envDefaultUsd: number | undefined,
): number {
  return flagOverrideUsd ?? envDefaultUsd ?? 0;
}
