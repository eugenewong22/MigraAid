/**
 * Retrieval accuracy, without generation.
 *
 * The full eval calls the model for every question, which is slow and costs
 * money, so it cannot gate every pull request that touches `content/`. Most
 * corpus regressions are retrieval regressions though: an item is worded so it
 * no longer matches the question it was written for, or a new item outranks the
 * right one. Those are visible from embeddings alone.
 *
 * Measured at several depths on purpose. Top-1 is the wrong single number —
 * the answer path hands `k` chunks to the model, so the right source at rank 3
 * still produces a correct, cited answer. recall@6 is the number that tracks
 * whether the product works; recall@1 tracks how well it is ranked.
 *
 * Run with: pnpm eval:offline   (needs DATABASE_URL + an embedding key, and an
 * ingested corpus — run `pnpm ingest` first).
 */
import "../env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contentItems } from "@/lib/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import { retrieve } from "@/lib/rag/retrieve";
import { DEFAULT_MIN_RETRIEVAL_SCORE } from "@/lib/safety/policy";
import type { Domain } from "@/lib/rag/types";

type Locale = "en" | "bn" | "ta" | "tl" | "zh" | "id" | "th" | "my";

interface GoldenItem {
  id?: string;
  question: string;
  locale?: Locale;
  domain?: Domain;
  mustCite?: boolean;
  expectSourceId?: string;
  expectRefusal?: boolean;
}

/** Depths worth knowing about. `k` in the answer path is 6. */
const DEPTHS = [1, 3, 6] as const;

/** Launch gates. recall@6 is the one that decides whether the product works. */
const GATES: Record<number, number> = { 1: 0.9, 6: 0.98 };

function minScore(): number {
  const raw = process.env.RAG_MIN_SCORE?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_MIN_RETRIEVAL_SCORE;
}

async function main() {
  const golden: GoldenItem[] = JSON.parse(
    await readFile(path.join(process.cwd(), "eval", "golden.json"), "utf8"),
  );
  const items = golden.filter((item) => item.mustCite && !item.expectRefusal);
  if (items.length === 0) {
    console.log("No retrieval-bearing golden items; nothing to check.");
    return;
  }

  const db = getDb();
  const threshold = minScore();
  console.log(`embedder: ${getEmbedder().generation}`);
  console.log(`min score: ${threshold}\n`);

  /** Rank (1-based) at which the expected source appeared, or null. */
  const ranks: Array<{ item: GoldenItem; rank: number | null; detail: string }> = [];

  for (const item of items) {
    const locale = item.locale ?? "en";
    const chunks = await retrieve({
      query: item.question,
      locale,
      domain: item.domain,
    });

    if (chunks.length === 0) {
      ranks.push({ item, rank: null, detail: "retrieved nothing" });
      continue;
    }

    // Resolve every retrieved chunk's item to its registry source in one query.
    const rows = await db
      .select({ id: contentItems.id, sourceId: contentItems.sourceId })
      .from(contentItems)
      .where(inArray(contentItems.id, chunks.map((c) => c.contentItemId)));
    const sourceOf = new Map(rows.map((r) => [r.id, r.sourceId]));

    const ordered = chunks.map((c) => sourceOf.get(c.contentItemId) ?? "?");
    const position = ordered.indexOf(item.expectSourceId ?? "");
    const clearsThreshold = chunks[0].score >= threshold;

    ranks.push({
      item,
      rank: position === -1 || !clearsThreshold ? null : position + 1,
      // The top three make sibling confusion diagnosable at a glance.
      detail: `top=${ordered.slice(0, 3).join(", ")} score=${chunks[0].score.toFixed(3)}`,
    });
  }

  const recall: Record<number, number> = {};
  for (const depth of DEPTHS) {
    recall[depth] =
      ranks.filter((r) => r.rank !== null && r.rank <= depth).length / ranks.length;
  }
  const mrr =
    ranks.reduce((total, r) => total + (r.rank ? 1 / r.rank : 0), 0) / ranks.length;

  for (const { item, rank, detail } of ranks) {
    if (rank === 1) continue;
    const label = item.id ?? item.question;
    console.log(
      `${rank === null ? "MISS" : `@${rank}  `}  [${item.locale ?? "en"}] ${label}`,
    );
    console.log(`        want=${item.expectSourceId} ${detail}`);
  }

  console.log(`\n${ranks.length} retrieval-bearing questions`);
  for (const depth of DEPTHS) {
    const gate = GATES[depth];
    const value = recall[depth];
    const verdict = gate === undefined ? "" : value >= gate ? " ✓" : ` ✗ need ${gate}`;
    console.log(`  recall@${depth}: ${(value * 100).toFixed(1)}%${verdict}`);
  }
  console.log(`  MRR:       ${mrr.toFixed(3)}`);

  const failed = DEPTHS.some(
    (depth) => GATES[depth] !== undefined && recall[depth] < GATES[depth],
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
