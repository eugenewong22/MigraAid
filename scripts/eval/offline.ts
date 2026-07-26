/**
 * Retrieval accuracy, without generation.
 *
 * The full eval calls the model for every question, which is slow and costs
 * money, so it cannot gate every pull request that touches `content/`. Most
 * corpus regressions are retrieval regressions though: an item is worded so it
 * no longer matches the question it was written for, or a new item outranks the
 * right one. Those are visible from embeddings alone.
 *
 * For each golden item that expects a citation, this checks the top-ranked chunk
 * belongs to the expected source and clears the grounding threshold the answer
 * path will later apply.
 *
 * Run with: pnpm eval:offline   (needs DATABASE_URL + an embedding key, and an
 * ingested corpus — run `pnpm ingest` first).
 */
import "../env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contentItems } from "@/lib/db/schema";
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

function minScore(): number {
  const raw = process.env.RAG_MIN_SCORE?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_MIN_RETRIEVAL_SCORE;
}

async function main() {
  const golden: GoldenItem[] = JSON.parse(
    await readFile(path.join(process.cwd(), "eval", "golden.json"), "utf8"),
  );
  // Only retrieval-bearing items: escalation and refusal cases never retrieve.
  const retrievalItems = golden.filter(
    (item) => item.mustCite && !item.expectRefusal,
  );
  if (retrievalItems.length === 0) {
    console.log("No retrieval-bearing golden items; nothing to check.");
    return;
  }

  const db = getDb();
  const threshold = minScore();
  let passed = 0;
  const failures: string[] = [];

  for (const item of retrievalItems) {
    const locale = item.locale ?? "en";
    const label = item.id ?? item.question;
    const chunks = await retrieve({
      query: item.question,
      locale,
      domain: item.domain,
    });

    if (chunks.length === 0) {
      failures.push(`${label}: retrieved nothing`);
      console.log(`FAIL  [${locale}] ${label} — no chunks`);
      continue;
    }

    const top = chunks[0];
    const checks: string[] = [];
    let ok = true;

    const clears = top.score >= threshold;
    ok &&= clears;
    checks.push(`score=${top.score.toFixed(3)}>=${threshold} ${clears ? "✓" : "✗"}`);

    if (item.expectSourceId) {
      const [row] = await db
        .select({ sourceId: contentItems.sourceId })
        .from(contentItems)
        .where(eq(contentItems.id, top.contentItemId))
        .limit(1);
      const good = row?.sourceId === item.expectSourceId;
      ok &&= good;
      checks.push(
        `source=${row?.sourceId ?? "?"} want=${item.expectSourceId} ${good ? "✓" : "✗"}`,
      );
    }

    if (ok) passed += 1;
    else failures.push(`${label}: ${checks.join(", ")}`);
    console.log(`${ok ? "PASS" : "FAIL"}  [${locale}] ${label}`);
    console.log(`      ${checks.join("  ·  ")}`);
  }

  // A corpus that answers nothing is the failure mode this whole gate exists for.
  const published = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(inArray(contentItems.status, ["published"]));
  console.log(`\n${published.length} published item(s) in the index.`);

  const score = Math.round((passed / retrievalItems.length) * 100);
  console.log(`${passed}/${retrievalItems.length} retrieval checks passed (${score}%)`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
