/**
 * Domain accuracy eval — the gate that makes MigraAid safe to ship as legal aid.
 *
 * For each golden question it runs the real retrieve→answer path and checks:
 *  - escalation behaviour matches expectation (high-stakes → refer to human),
 *  - substantive answers carry citations,
 *  - the answer contains the expected key facts.
 *
 * Extend `eval/golden.json` with NGO-verified Q&A per domain and per language (M2).
 * Run with: pnpm eval   (needs DATABASE_URL + OPENAI_API_KEY and optionally VOYAGE_API_KEY,
 * and an ingested corpus — run `pnpm ingest` first).
 */
import "../env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { retrieve } from "@/lib/rag/retrieve";
import { answer, preflightSafetyAnswer } from "@/lib/rag/answer";

type Locale = "en" | "bn" | "ta" | "tl" | "zh" | "id" | "th" | "my";

interface GoldenItem {
  question: string;
  locale?: Locale;
  domain?: "legal_rights" | "healthcare" | "housing" | "financial" | "settlement";
  mustCite?: boolean;
  shouldEscalate?: boolean;
  expectContains?: string[];
}

async function main() {
  const raw = await readFile(
    path.join(process.cwd(), "eval", "golden.json"),
    "utf8",
  );
  const golden: GoldenItem[] = JSON.parse(raw);

  let passed = 0;
  for (const item of golden) {
    const locale = item.locale ?? "en";
    const deterministic = preflightSafetyAnswer(item.question, locale);
    const chunks = deterministic
      ? []
      : await retrieve({
          query: item.question,
          locale,
          domain: item.domain,
        });
    const result =
      deterministic ??
      (await answer({ query: item.question, locale, chunks }));

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
    if (item.expectContains) {
      const lower = result.text.toLowerCase();
      for (const needle of item.expectContains) {
        const good = lower.includes(needle.toLowerCase());
        ok &&= good;
        checks.push(`contains "${needle}" ${good ? "✓" : "✗"}`);
      }
    }

    if (ok) passed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  [${locale}] ${item.question}`);
    console.log(`      ${checks.join("  ·  ")}`);
  }

  const score = golden.length ? Math.round((passed / golden.length) * 100) : 0;
  console.log(`\n${passed}/${golden.length} passed (${score}%)`);
  process.exit(passed === golden.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
