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
    const client = postgres(url, { prepare: false });
    db = drizzle(client, { schema });
  }
  return db;
}

export { schema };
