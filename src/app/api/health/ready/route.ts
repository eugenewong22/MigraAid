import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contentChunks, contentItems } from "@/lib/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import {
  knowledgeReadiness,
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
    const [published, indexed] = await Promise.all([
      db
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(eq(contentItems.status, "published")),
      db
        .selectDistinct({ id: contentChunks.contentItemId })
        .from(contentChunks)
        .where(eq(contentChunks.embeddingGeneration, generation)),
    ]);
    const state = knowledgeReadiness(
      published.map(({ id }) => id),
      indexed.map(({ id }) => id),
    );
    // Key-presence checks (no live provider call): a deploy missing the answer/
    // vision key would 200 "ready" yet fail every chat turn at runtime, and a
    // missing cron secret silently disables data retention.
    const inferenceConfigured = isInferenceConfigured();
    const retentionConfigured = isRetentionConfigured();
    const ready = state.ready && inferenceConfigured && retentionConfigured;
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
