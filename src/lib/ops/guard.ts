/**
 * The one thing a generative route calls before doing any work.
 *
 * Wraps {@link gate} with the decisions every such route repeats: is the
 * feature switched on, is the caller inside their quota, and has today's spend
 * run out. Returning a ready-made `Response` keeps the policy in one place
 * rather than drifting between `/api/chat` and `/api/contract` — which is how
 * they ended up with different behaviour on limiter failure in the first place.
 */
import { NextRequest } from "next/server";
import {
  UNTRUSTED_CLIENT_KEY,
  clientKey,
  reportUntrustedClientKey,
} from "@/lib/ratelimit";
import { budgetStatus, effectiveCeilingUsd } from "./budget";
import { featureAllowed, isBudgetOverridden, type ToggleableFeature } from "./flags";
import { gate, type GateResult } from "./gate";
import { alertOnce } from "./alert";

export interface GuardOptions {
  feature: ToggleableFeature;
  limit: number;
  windowMs?: number;
  /** Cheap routes need not consume a fleet-wide slot. */
  countsTowardGlobal?: boolean;
  now?: number;
}

export interface GuardOutcome {
  /** Present when the request must not proceed. */
  response?: Response;
  gate: GateResult;
  clientIp: string;
}

function retryAfterSeconds(resetAt: number, now: number): string {
  return String(Math.max(1, Math.ceil((resetAt - now) / 1000)));
}

/**
 * A refusal a worker can act on. 503 rather than 500 because this is a
 * temporary, self-imposed stop, and the body names the alternative that is
 * still working.
 */
function degradedResponse(retryAfter = 300): Response {
  return Response.json(
    { error: "unavailable", mode: "degraded" },
    { status: 503, headers: { "retry-after": String(retryAfter) } },
  );
}

/**
 * Decide whether a generative request may proceed.
 *
 * Never throws. Every failure path resolves to a refusal, because the
 * alternative — an exception on the hot path when the ops store is already
 * unhappy — is the worst possible moment for one.
 */
export async function guardGenerativeRoute(
  req: NextRequest,
  area: string,
  opts: GuardOptions,
): Promise<GuardOutcome> {
  const now = opts.now ?? Date.now();
  const clientIp = clientKey(req.headers);
  if (clientIp === UNTRUSTED_CLIENT_KEY) reportUntrustedClientKey(area);

  const result = await gate({
    key: `${opts.feature}:${clientIp}`,
    limit: opts.limit,
    windowMs: opts.windowMs ?? 60_000,
    countsTowardGlobal: opts.countsTowardGlobal,
    now,
  });

  const ceilingUsd = effectiveCeilingUsd(
    result.flags.dailyBudgetUsd,
    process.env.BUDGET_DAILY_USD ? Number(process.env.BUDGET_DAILY_USD) : undefined,
  );
  const budget = budgetStatus({
    spentMicros: result.spendMicros,
    ceilingUsd,
    overridden: isBudgetOverridden(result.flags, now),
  });

  // Report the state the app has put itself into, once per day per event, so a
  // maintainer who was asleep can read what happened rather than infer it.
  if (result.source === "unavailable" || result.source === "postgres") {
    void alertOnce(`limiter-degraded:${result.source}`, {
      title: "Rate limiter degraded",
      detail: `The ops store is unreachable; serving from the ${result.source} tier.`,
    });
  }
  if (budget.state !== "ok") {
    void alertOnce(`budget-${budget.state}`, {
      title: `Inference budget ${budget.state}`,
      detail:
        `Spent ${(budget.spentMicros / 1_000_000).toFixed(2)} of ` +
        `${ceilingUsd.toFixed(2)} USD today (${Math.round(budget.fraction * 100)}%).`,
    });
  }

  const feature = featureAllowed(result.flags, opts.feature);
  if (!feature.allowed) {
    return { response: degradedResponse(), gate: result, clientIp };
  }

  // Spend runs out: chat degrades at the ceiling, the vision route earlier.
  if (budget.degrade) {
    return { response: degradedResponse(), gate: result, clientIp };
  }
  if (budget.contractDisabled && opts.feature === "contract") {
    return { response: degradedResponse(), gate: result, clientIp };
  }

  if (!result.allowed) {
    return {
      response: new Response("Too many requests", {
        status: 429,
        headers: { "retry-after": retryAfterSeconds(result.resetAt, now) },
      }),
      gate: result,
      clientIp,
    };
  }

  return { gate: result, clientIp };
}
