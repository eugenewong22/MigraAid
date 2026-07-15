/**
 * Lazily-constructed Drizzle client backed by postgres.js.
 *
 * Lazy so that importing db code (types, schema) never requires a live database —
 * the connection is only opened on first `getDb()` call. This keeps builds and
 * unit tests working without DATABASE_URL set.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env.local and provide a Postgres (pgvector) connection string.",
      );
    }
    // prepare:false is required for transaction-pooled Postgres (Supabase/pgbouncer).
    const client = postgres(url, {
      prepare: false,
      // Serverless instances should not each open a large default pool.
      max: 1,
      connect_timeout: 10,
      idle_timeout: 20,
      max_lifetime: 10 * 60,
      // Cap any single statement so a hung query cannot consume the whole
      // serverless function budget (kept below the route maxDuration).
      connection: { statement_timeout: 15_000 },
    });
    db = drizzle(client, { schema });
  }
  return db;
}

export { schema };
