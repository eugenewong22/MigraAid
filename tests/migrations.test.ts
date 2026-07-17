import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("database security migration", () => {
  it("enables default-deny RLS for every public application table", async () => {
    const securitySql = await readFile(
      path.join(process.cwd(), "drizzle", "0003_security_rls.sql"),
      "utf8",
    );
    const governanceSql = await readFile(
      path.join(
        process.cwd(),
        "drizzle",
        "0005_governance_handoffs_metrics.sql",
      ),
      "utf8",
    );
    const sql = `${securitySql}\n${governanceSql}`;
    const protectedTables = [
      "audit_log",
      "content_chunks",
      "content_items",
      "contract_reviews",
      "conversations",
      "daily_metrics",
      "emergency_contacts",
      "feedback",
      "messages",
      "orgs",
      "referrals",
    ];

    for (const table of protectedTables) {
      expect(sql).toContain(
        `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`,
      );
    }
    expect(sql).toContain("FROM PUBLIC");
    expect(sql).toContain("'anon', 'authenticated'");
    expect(governanceSql).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC",
    );
    expect(governanceSql).toContain("audit_log_append_only");
  });

  it("marks every schema table RLS-enabled so future generated migrations stay safe", async () => {
    const schema = await readFile(
      path.join(process.cwd(), "src", "lib", "db", "schema.ts"),
      "utf8",
    );
    expect(schema.match(/\.enableRLS\(\)/g)).toHaveLength(11);
  });

  it("cleans legacy nullable rows before applying new not-null constraints", async () => {
    const sql = await readFile(
      path.join(
        process.cwd(),
        "drizzle",
        "0005_governance_handoffs_metrics.sql",
      ),
      "utf8",
    );
    expect(sql.indexOf('DELETE FROM "feedback"')).toBeLessThan(
      sql.indexOf(
        'ALTER TABLE "feedback" ALTER COLUMN "conversation_id" SET NOT NULL',
      ),
    );
    expect(sql.indexOf('UPDATE "referrals"')).toBeLessThan(
      sql.indexOf(
        'ALTER TABLE "referrals" ALTER COLUMN "handoff_code_hash" SET NOT NULL',
      ),
    );
  });

  it("indexes referrals by conversation for chat and retention lookups", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "drizzle", "0008_large_hannibal_king.sql"),
      "utf8",
    );
    expect(sql).toContain(
      'CREATE INDEX "referrals_conversation_idx" ON "referrals" USING btree ("conversation_id")',
    );
  });

  it("drops the unused free-text feedback comment column", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "drizzle", "0009_noisy_venom.sql"),
      "utf8",
    );
    expect(sql).toContain('ALTER TABLE "feedback" DROP COLUMN "comment"');
  });
});
