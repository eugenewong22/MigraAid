/**
 * Release-time migration runner — keeps the database schema ahead of the code.
 *
 * Invoked by the `vercel-build` script so a production deploy can never ship
 * application code that queries columns its database does not have yet (new
 * code + old schema is an outage; old code + new additive schema is fine).
 *
 * Guards:
 * - Requires the explicit `MIGRATION_DATABASE_URL`. It deliberately does NOT
 *   fall back to the runtime `DATABASE_URL`: that is a transaction-pooled,
 *   least-privilege connection (Supabase port 6543) which can neither hold the
 *   advisory locks drizzle-kit needs nor run DDL as table owner.
 * - Rejects a transaction-pooler URL outright — on Supabase the session pooler
 *   is the same host on port 5432.
 * - A production Vercel build without the variable fails loudly; preview and
 *   local builds skip with a warning so they keep working without DDL access.
 */
import "../env";
import { spawnSync } from "node:child_process";

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const isProductionRelease = process.env.VERCEL_ENV === "production";

if (!migrationUrl) {
  if (isProductionRelease) {
    console.error(
      "[release] MIGRATION_DATABASE_URL is not set for a production build. " +
        "Refusing to deploy code ahead of the database schema. Set it in the " +
        "Vercel Production environment to the session-pooled/table-owner " +
        "connection (Supabase: same host as DATABASE_URL, port 5432).",
    );
    process.exit(1);
  }
  console.warn(
    "[release] MIGRATION_DATABASE_URL not set — skipping migrations " +
      `(${process.env.VERCEL_ENV ?? "local"} build).`,
  );
  process.exit(0);
}

try {
  const { port, hostname } = new URL(migrationUrl);
  if (port === "6543") {
    console.error(
      `[release] MIGRATION_DATABASE_URL points at ${hostname}:6543 — the ` +
        "transaction pooler. drizzle-kit migrations need a session-scoped " +
        "connection; on Supabase use the session pooler: same host, port 5432.",
    );
    process.exit(1);
  }
} catch {
  console.error("[release] MIGRATION_DATABASE_URL is not a valid URL.");
  process.exit(1);
}

console.log("[release] applying database migrations before build…");
const result = spawnSync("pnpm", ["db:migrate"], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
