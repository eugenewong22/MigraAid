import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contentChunks, contentItems } from "@/lib/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import {
  knowledgeReadiness,
  hasAllMigrationsApplied,
  isInferenceConfigured,
  isRetentionConfigured,
} from "@/lib/health/readiness";
import { reportError } from "@/lib/observability/sentry";

export const runtime = "nodejs";

/** Database/schema/current-vector-space readiness for pre-traffic health gates. */
export async function GET() {
  try {
    const db = getDb();
    const generation = getEmbedder().generation;
    const [published, indexed, migrations] = await Promise.all([
      db
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(eq(contentItems.status, "published")),
      db
        .selectDistinct({ id: contentChunks.contentItemId })
        .from(contentChunks)
        .where(eq(contentChunks.embeddingGeneration, generation)),
      // Catches deploys that bypassed the build-time migration gate (e.g.
      // Vercel "Promote to Production" reusing a preview build): code whose
      // bundled journal is ahead of the database must not take traffic. A
      // missing migrations table throws → the catch below reports not_ready.
      db.execute<{ count: number }>(
        sql`select count(*)::int as count from drizzle."__drizzle_migrations"`,
      ),
    ]);
    const state = knowledgeReadiness(
      published.map(({ id }) => id),
      indexed.map(({ id }) => id),
    );
    const migrationsApplied = hasAllMigrationsApplied(
      Number(migrations[0]?.count ?? 0),
    );
    // Key-presence checks (no live provider call): a deploy missing the answer/
    // vision key would 200 "ready" yet fail every chat turn at runtime, and a
    // missing cron secret silently disables data retention.
    const inferenceConfigured = isInferenceConfigured();
    const retentionConfigured = isRetentionConfigured();
    const ready =
      state.ready &&
      migrationsApplied &&
      inferenceConfigured &&
      retentionConfigured;
    return Response.json(
      { status: ready ? "ready" : "not_ready" },
      {
        status: ready ? 200 : 503,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    await reportError(error, "health.ready");
    return Response.json(
      { status: "not_ready" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
