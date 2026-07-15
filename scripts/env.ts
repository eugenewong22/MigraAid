/**
 * Loads local env vars for standalone scripts (tsx doesn't auto-load .env the
 * way `next dev` does). Mirrors Next.js's own precedence: `.env` provides
 * defaults, `.env.local` overrides if present. Import this for its side effect
 * before reading process.env in any script entry point.
 */
import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(process.cwd(), ".env") });
config({ path: path.resolve(process.cwd(), ".env.local"), override: true });
