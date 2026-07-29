/**
 * Runtime operating mode and feature flags.
 *
 * MigraAid is run by one person who sleeps. So the app has to protect itself
 * rather than page someone: when spend runs away, when the flag store is gone,
 * or when something needs stopping right now, it degrades on its own and the
 * alert is a record of what it did, not the mechanism that does it.
 *
 * There is exactly one degradation, reached by several routes, because three
 * separate half-broken states would be three things to reason about at 3am:
 *
 *   full      everything.
 *   degraded  the generative routes refuse; the referral directory and the
 *             emergency contacts stay up. This is the state the app falls into
 *             by itself, and it is deliberately still useful — a worker who
 *             cannot get an answer can still get a phone number.
 *   off       emergency contacts only.
 *
 * Flag values are strings from an external store, so **every one is validated
 * against an allowlist defined here in code**. A banner is a message-catalog
 * key rather than free text, which means a mistyped or compromised flag store
 * can only show workers copy that has already been written and translated. It
 * cannot inject prose into a safety-critical surface.
 */

export const OPS_MODES = ["full", "degraded", "off"] as const;
export type OpsMode = (typeof OPS_MODES)[number];

/** Features that can be switched off independently of the mode. */
export const TOGGLEABLE_FEATURES = ["chat", "contract", "feedback"] as const;
export type ToggleableFeature = (typeof TOGGLEABLE_FEATURES)[number];

export interface OpsFlags {
  mode: OpsMode;
  /** A feature is enabled unless explicitly switched off. */
  disabled: ReadonlySet<ToggleableFeature>;
  /** Overrides `BUDGET_DAILY_USD` when set. */
  dailyBudgetUsd?: number;
  /** Ignore the spend ceiling until this instant. */
  overrideUntil?: number;
  /** Message-catalog key for a site-wide banner. Never free text. */
  bannerKey?: string;
}

export const DEFAULT_FLAGS: OpsFlags = {
  mode: "full",
  disabled: new Set(),
};

/**
 * What the app falls back to when the flag store cannot be reached and the
 * cached value is too old to trust.
 *
 * Generative routes fail closed. An unreachable store means no rate limiting
 * *and* no spend accounting at the same moment — exactly the conditions under
 * which an unbounded bill happens — so serving through it would defeat the
 * point of having a ceiling at all. Everything non-generative stays up.
 */
export const UNREACHABLE_FLAGS: OpsFlags = {
  mode: "degraded",
  disabled: new Set(),
};

function parseMode(raw: string | undefined): OpsMode | undefined {
  return (OPS_MODES as readonly string[]).includes(raw ?? "")
    ? (raw as OpsMode)
    : undefined;
}

function parsePositiveNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseTimestamp(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Catalog keys are dotted lowercase identifiers, never prose. */
const BANNER_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;

/**
 * Turn a raw `HGETALL` result into flags, discarding anything unrecognised.
 *
 * Unparseable values fall back to the default rather than failing the request:
 * a fat-fingered flag must not take the product down, and the default is the
 * permissive-but-safe one for everything except `mode`.
 */
export function parseFlags(raw: Record<string, string | undefined>): OpsFlags {
  const disabled = new Set<ToggleableFeature>();
  for (const feature of TOGGLEABLE_FEATURES) {
    if (raw[feature] === "off") disabled.add(feature);
  }

  const bannerKey = raw["banner.key"];

  return {
    mode: parseMode(raw.mode) ?? "full",
    disabled,
    dailyBudgetUsd: parsePositiveNumber(raw["budget.daily_usd"]),
    overrideUntil: parseTimestamp(raw["budget.override_until"]),
    bannerKey: bannerKey && BANNER_KEY.test(bannerKey) ? bannerKey : undefined,
  };
}

/** Is the spend ceiling currently suspended by a manual override? */
export function isBudgetOverridden(flags: OpsFlags, now: number): boolean {
  return flags.overrideUntil !== undefined && flags.overrideUntil > now;
}

export interface FeatureDecision {
  allowed: boolean;
  /** Why not — for the response body and the log, never shown raw to a worker. */
  reason?: "mode_off" | "mode_degraded" | "feature_disabled";
}

/**
 * May this feature run right now?
 *
 * `emergency` and the other static surfaces never consult this — they are the
 * things that must survive every degradation.
 */
export function featureAllowed(
  flags: OpsFlags,
  feature: ToggleableFeature,
): FeatureDecision {
  if (flags.mode === "off") return { allowed: false, reason: "mode_off" };
  if (flags.mode === "degraded") {
    return { allowed: false, reason: "mode_degraded" };
  }
  if (flags.disabled.has(feature)) {
    return { allowed: false, reason: "feature_disabled" };
  }
  return { allowed: true };
}
