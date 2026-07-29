import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getEmbedder } from "@/lib/embeddings";
import {
  hasAllMigrationsApplied,
  isInferenceConfigured,
  isRetentionConfigured,
} from "@/lib/health/readiness";
import { checkEnv } from "@/env";
import { gate } from "@/lib/ops/gate";
import { budgetStatus, effectiveCeilingUsd } from "@/lib/ops/budget";
import { isBudgetOverridden } from "@/lib/ops/flags";
import { reportError } from "@/lib/observability/sentry";

export const runtime = "nodejs";

/**
 * How long a readiness answer may be reused.
 *
 * The endpoint is unauthenticated, so an uptime monitor — or anyone else —
 * polling it must not turn into database load. Twenty seconds is short enough
 * for a health gate to react and long enough that a monitor at 30s intervals
 * costs about one query per minute per instance rather than one per probe.
 */
const CACHE_TTL_MS = 20_000;

interface Snapshot {
  ready: boolean;
  detail: Record<string, unknown>;
  at: number;
}

let cached: Snapshot | null = null;

/** Test seam. */
export function resetReadinessCacheForTesting(): void {
  cached = null;
}

/**
 * One aggregate instead of three queries, two of which were full scans on a
 * `max: 1` pool. `not exists` lets Postgres stop at the first missing chunk per
 * item rather than materialising every id on both sides to compare in JS.
 */
async function inspect(): Promise<Snapshot> {
  const db = getDb();
  const generation = getEmbedder().generation;

  const [row] = await db.execute<{
    published: number;
    unindexed: number;
    migrations: number;
  }>(sql`
    select
      count(*) filter (where status = 'published')::int as published,
      count(*) filter (
        where status = 'published' and not exists (
          select 1 from content_chunks c
          where c.content_item_id = content_items.id
            and c.embedding_generation = ${generation}
        )
      )::int as unindexed,
      (select count(*)::int from drizzle."__drizzle_migrations") as migrations
    from content_items
  `);

  const published = Number(row?.published ?? 0);
  const unindexed = Number(row?.unindexed ?? 0);
  const migrationsApplied = hasAllMigrationsApplied(Number(row?.migrations ?? 0));
  const env = checkEnv();

  // A corpus that answers nothing is the failure this endpoint exists to catch:
  // every chat turn would return the ungrounded refusal, and nothing else would
  // look wrong.
  const knowledgeReady = published > 0 && unindexed === 0;

  const ready =
    knowledgeReady &&
    migrationsApplied &&
    isInferenceConfigured() &&
    isRetentionConfigured() &&
    env.ok;

  return {
    ready,
    at: Date.now(),
    detail: {
      publishedItems: published,
      unindexedItems: unindexed,
      embeddingGeneration: generation,
      migrationsApplied,
      inferenceConfigured: isInferenceConfigured(),
      retentionConfigured: isRetentionConfigured(),
      envValid: env.ok,
      envProblems: env.problems.map((p) => p.key),
    },
  };
}

/**
 * Readiness, plus the operating mode.
 *
 * Reporting `not_ready` while degraded lets a platform health gate shed traffic
 * on its own — which matters when the app has degraded itself at 3am and there
 * is nobody to notice.
 *
 * The public body is deliberately opaque. `?verbose=1` with the cron bearer
 * token returns which check failed, so a maintainer can diagnose without that
 * detail being readable by anyone who finds the URL.
 */
export async function GET(req: NextRequest) {
  try {
    // Cheap and unauthenticated, so it gets a quota of its own.
    const limited = await gate({
      key: `ready:${req.headers.get("x-vercel-forwarded-for") ?? "anon"}`,
      limit: 30,
      windowMs: 60_000,
      countsTowardGlobal: false,
    });
    if (!limited.allowed) {
      return Response.json(
        { status: "not_ready" },
        { status: 429, headers: { "cache-control": "no-store" } },
      );
    }

    const now = Date.now();
    if (!cached || now - cached.at > CACHE_TTL_MS) {
      cached = await inspect();
    }

    const ceilingUsd = effectiveCeilingUsd(
      limited.flags.dailyBudgetUsd,
      process.env.BUDGET_DAILY_USD
        ? Number(process.env.BUDGET_DAILY_USD)
        : undefined,
    );
    const budget = budgetStatus({
      spentMicros: limited.spendMicros,
      ceilingUsd,
      overridden: isBudgetOverridden(limited.flags, now),
    });

    const mode = limited.flags.mode;
    const ready = cached.ready && mode === "full";

    const secret = process.env.CRON_SECRET;
    const verbose =
      req.nextUrl.searchParams.get("verbose") === "1" &&
      Boolean(secret) &&
      req.headers.get("authorization") === `Bearer ${secret}`;

    return Response.json(
      {
        status: ready ? "ready" : "not_ready",
        mode,
        ...(verbose
          ? {
              detail: cached.detail,
              ops: {
                gateSource: limited.source,
                budgetState: budget.state,
                spentUsd: Number((budget.spentMicros / 1_000_000).toFixed(4)),
                ceilingUsd,
                disabledFeatures: [...limited.flags.disabled],
              },
            }
          : {}),
      },
      {
        status: ready ? 200 : 503,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    await reportError(error, "health.ready");
    return Response.json(
      { status: "not_ready", mode: "unknown" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
