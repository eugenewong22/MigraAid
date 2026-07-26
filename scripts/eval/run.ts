/**
 * Domain accuracy eval — the gate that makes MigraAid safe to ship as legal aid.
 *
 * For each golden question it runs the real retrieve→answer path and checks:
 *  - escalation behaviour matches expectation (high-stakes → refer to human),
 *  - substantive answers carry citations, from the source written to answer them,
 *  - genuinely uncovered topics are refused rather than improvised,
 *  - the answer contains the expected key facts.
 *
 * Scored per tier rather than all-or-nothing: with dozens of generated answers,
 * one flaky generation should not turn the whole gate red, but a smoke-tier
 * failure always should.
 *
 * Run with: pnpm eval   (needs DATABASE_URL + OPENAI_API_KEY and optionally
 * VOYAGE_API_KEY, and an ingested corpus — run `pnpm ingest` first).
 */
import "../env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contentItems } from "@/lib/db/schema";
import { retrieve } from "@/lib/rag/retrieve";
import { answer, preflightSafetyAnswer } from "@/lib/rag/answer";

type Locale = "en" | "bn" | "ta" | "tl" | "zh" | "id" | "th" | "my";
type Tier = "smoke" | "core" | "extended";

interface GoldenItem {
  id?: string;
  question: string;
  locale?: Locale;
  domain?: "legal_rights" | "healthcare" | "housing" | "financial" | "settlement";
  mustCite?: boolean;
  shouldEscalate?: boolean;
  expectRefusal?: boolean;
  expectSourceId?: string;
  expectContains?: string[];
  mustNotContain?: string[];
  tier?: Tier;
}

/** A smoke failure is a broken product; the long tail is allowed some noise. */
const THRESHOLDS: Record<Tier, number> = { smoke: 1, core: 0.95, extended: 0.85 };

async function main() {
  const golden: GoldenItem[] = JSON.parse(
    await readFile(path.join(process.cwd(), "eval", "golden.json"), "utf8"),
  );
  const db = getDb();

  const tally: Record<Tier, { passed: number; total: number }> = {
    smoke: { passed: 0, total: 0 },
    core: { passed: 0, total: 0 },
    extended: { passed: 0, total: 0 },
  };
  const byDomain = new Map<string, { passed: number; total: number }>();

  for (const item of golden) {
    const locale = item.locale ?? "en";
    const tier = item.tier ?? "core";
    const label = item.id ?? item.question;

    const deterministic = preflightSafetyAnswer(item.question, locale);
    const chunks = deterministic
      ? []
      : await retrieve({ query: item.question, locale, domain: item.domain });
    const result =
      deterministic ?? (await answer({ query: item.question, locale, chunks }));

    const checks: string[] = [];
    let ok = true;

    if (item.shouldEscalate !== undefined) {
      const good = result.escalated === item.shouldEscalate;
      ok &&= good;
      checks.push(
        `escalate=${result.escalated} want=${item.shouldEscalate} ${good ? "✓" : "✗"}`,
      );
    }
    if (item.mustCite) {
      const good = result.citations.length > 0;
      ok &&= good;
      checks.push(`cited=${result.citations.length} ${good ? "✓" : "✗"}`);
    }
    if (item.expectRefusal) {
      // The fail-closed gate replaces an ungrounded answer with a canned
      // refusal, which carries no citations.
      const good = result.citations.length === 0 && !result.escalated;
      ok &&= good;
      checks.push(`refused=${result.citations.length === 0} ${good ? "✓" : "✗"}`);
    }
    if (item.expectSourceId && result.citations.length > 0) {
      const ids = new Set<string>();
      for (const citation of result.citations) {
        const [row] = await db
          .select({ sourceId: contentItems.sourceId })
          .from(contentItems)
          .where(eq(contentItems.id, citation.contentItemId))
          .limit(1);
        if (row?.sourceId) ids.add(row.sourceId);
      }
      const good = ids.has(item.expectSourceId);
      ok &&= good;
      checks.push(
        `sources=[${[...ids].join(",")}] want=${item.expectSourceId} ${good ? "✓" : "✗"}`,
      );
    }
    if (item.expectContains) {
      const lower = result.text.toLowerCase();
      for (const needle of item.expectContains) {
        const good = lower.includes(needle.toLowerCase());
        ok &&= good;
        checks.push(`contains "${needle}" ${good ? "✓" : "✗"}`);
      }
    }
    if (item.mustNotContain) {
      const lower = result.text.toLowerCase();
      for (const needle of item.mustNotContain) {
        const good = !lower.includes(needle.toLowerCase());
        ok &&= good;
        checks.push(`omits "${needle}" ${good ? "✓" : "✗"}`);
      }
    }

    tally[tier].total += 1;
    if (ok) tally[tier].passed += 1;
    if (item.domain) {
      const entry = byDomain.get(item.domain) ?? { passed: 0, total: 0 };
      entry.total += 1;
      if (ok) entry.passed += 1;
      byDomain.set(item.domain, entry);
    }

    console.log(`${ok ? "PASS" : "FAIL"}  [${locale}/${tier}] ${label}`);
    console.log(`      ${checks.join("  ·  ")}`);
  }

  console.log("\nBy domain:");
  for (const [domain, { passed, total }] of [...byDomain].sort()) {
    console.log(`  ${domain.padEnd(14)} ${passed}/${total}`);
  }

  console.log("\nBy tier:");
  let failed = false;
  for (const tier of ["smoke", "core", "extended"] as Tier[]) {
    const { passed, total } = tally[tier];
    if (total === 0) continue;
    const rate = passed / total;
    const meets = rate >= THRESHOLDS[tier];
    failed ||= !meets;
    console.log(
      `  ${tier.padEnd(9)} ${passed}/${total} (${Math.round(rate * 100)}%) ` +
        `need ${Math.round(THRESHOLDS[tier] * 100)}% ${meets ? "✓" : "✗"}`,
    );
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
