/**
 * Server environment, validated once.
 *
 * Every variable used to be read ad-hoc at its point of use, so a missing or
 * malformed one surfaced as a runtime failure in whichever request happened to
 * touch it first — or, worse, as a silent degradation. Several of these are
 * load-bearing in ways that are not obvious:
 *
 * - Without Upstash, rate limits become per-lambda (so effectively absent under
 *   load) and there is nowhere to keep the spend counter or the feature flags.
 * - Without a Sentry DSN, every degradation signal this app raises is delivered
 *   to nobody.
 * - RATE_LIMIT_HASH_SALT falls back to the Upstash token when unset, so rotating
 *   that token silently resets every rate-limit bucket and every privacy
 *   tombstone digest at once.
 *
 * So in production these are required, and a deployment missing one fails the
 * *deploy* rather than serving traffic in a degraded state — the same posture
 * `scripts/release/migrate.ts` already takes for schema drift.
 *
 * Client-visible values live in `env.client.ts`: `NEXT_PUBLIC_*` are inlined
 * literally by the compiler, so they cannot be read through a dynamic lookup.
 */
import { z } from "zod";

/** Just a bag of strings — deliberately looser than NodeJS.ProcessEnv, which
 * this project's type augmentation makes awkward to construct in tests. */
export type EnvSource = Record<string, string | undefined>;

/** True on a Vercel Production deployment — not on preview, not locally. */
export function isProductionDeployment(
  env: EnvSource = process.env,
): boolean {
  return env.VERCEL_ENV === "production";
}

const httpsUrl = z
  .string()
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an absolute HTTPS URL");

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema.optional(),
  );

/**
 * Shape only. Which of these are *required* depends on the deployment, and is
 * decided by `PRODUCTION_REQUIRED` below rather than in the schema, because the
 * same schema has to parse a local `.env.local` with half of them missing.
 */
const serverSchema = z.object({
  DATABASE_URL: optional(z.string().min(1)),
  MIGRATION_DATABASE_URL: optional(z.string().min(1)),
  OPENAI_API_KEY: optional(z.string().min(1)),
  VOYAGE_API_KEY: optional(z.string().min(1)),

  EMBEDDING_PROVIDER: optional(z.enum(["voyage", "openai"])),
  EMBEDDING_MODEL: optional(z.string().min(1)),

  CRON_SECRET: optional(z.string().min(32, "must be at least 32 characters")),
  DATA_RETENTION_DAYS: optional(z.coerce.number().int().min(1).max(30)),
  RAG_MIN_SCORE: optional(z.coerce.number().min(0).max(1)),

  UPSTASH_REDIS_REST_URL: optional(httpsUrl),
  UPSTASH_REDIS_REST_TOKEN: optional(z.string().min(1)),
  RATE_LIMIT_HASH_SALT: optional(
    z.string().min(32, "must be at least 32 characters"),
  ),
  TRUST_PROXY_HEADERS: optional(z.enum(["true", "false"])),

  BUDGET_DAILY_USD: optional(z.coerce.number().positive()),
  BUDGET_MONTHLY_USD: optional(z.coerce.number().positive()),
  ALERT_WEBHOOK_URL: optional(httpsUrl),

  SENTRY_DSN: optional(z.string().min(1)),
  ALLOW_INSECURE_DEV_ADMIN: optional(z.enum(["true", "false"])),
});

export type ServerEnv = z.infer<typeof serverSchema>;

/** Required on a production deployment, with why, for the error message. */
const PRODUCTION_REQUIRED: ReadonlyArray<[keyof ServerEnv, string]> = [
  ["DATABASE_URL", "nothing can be persisted or retrieved without it"],
  ["OPENAI_API_KEY", "no answer, contract analysis, or embedding can be produced"],
  ["CRON_SECRET", "the retention cron 401s, so worker data is never deleted"],
  ["UPSTASH_REDIS_REST_URL", "rate limits, spend ceiling and feature flags all live here"],
  ["UPSTASH_REDIS_REST_TOKEN", "rate limits, spend ceiling and feature flags all live here"],
  ["RATE_LIMIT_HASH_SALT", "otherwise it silently follows the Upstash token, so rotating that token resets every bucket and tombstone"],
  ["SENTRY_DSN", "it is the delivery channel for every degradation signal this app raises"],
  ["ALERT_WEBHOOK_URL", "nothing reaches a human when the app degrades itself"],
  ["BUDGET_DAILY_USD", "there is no ceiling on inference spend without it"],
  ["EMBEDDING_PROVIDER", "otherwise the vector space is decided by which key happens to be set"],
  ["EMBEDDING_MODEL", "otherwise the vector space is decided by which key happens to be set"],
];

export interface EnvProblem {
  key: string;
  message: string;
}

/** Validate without throwing, so callers can report every problem at once. */
export function checkEnv(env: EnvSource = process.env): {
  ok: boolean;
  problems: EnvProblem[];
  value?: ServerEnv;
} {
  const parsed = serverSchema.safeParse(env);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({
        key: String(issue.path[0] ?? "(root)"),
        message: issue.message,
      })),
    };
  }

  const problems: EnvProblem[] = [];
  if (isProductionDeployment(env)) {
    for (const [key, why] of PRODUCTION_REQUIRED) {
      if (parsed.data[key] === undefined) {
        problems.push({ key, message: `required in production — ${why}` });
      }
    }
    // A local-only auth bypass has no business existing in production, and
    // failing the deploy is the only reliable way to say so.
    if (parsed.data.ALLOW_INSECURE_DEV_ADMIN === "true") {
      problems.push({
        key: "ALLOW_INSECURE_DEV_ADMIN",
        message: "must never be enabled in production",
      });
    }
  }

  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, problems: [], value: parsed.data };
}

export function formatEnvProblems(problems: readonly EnvProblem[]): string {
  return problems.map((p) => `  ${p.key}: ${p.message}`).join("\n");
}

let cached: ServerEnv | null = null;

/**
 * The validated environment. Throws on first call if anything is wrong, which
 * `instrumentation.register()` triggers once per cold start — before any
 * request handler runs.
 */
export function getEnv(): ServerEnv {
  if (cached) return cached;
  const result = checkEnv();
  if (!result.ok) {
    throw new Error(
      `Invalid environment:\n${formatEnvProblems(result.problems)}`,
    );
  }
  cached = result.value!;
  return cached;
}

/** Test seam. */
export function resetEnvForTesting(): void {
  cached = null;
}
