import { describe, expect, it } from "vitest";
import {
  checkEnv,
  formatEnvProblems,
  isProductionDeployment,
  type EnvSource,
} from "@/env";

/** A production environment with everything load-bearing present. */
const PRODUCTION: EnvSource = {
  VERCEL_ENV: "production",
  DATABASE_URL: "postgres://user:pass@db.example.com:5432/migraaid",
  OPENAI_API_KEY: "sk-test",
  CRON_SECRET: "c".repeat(32),
  UPSTASH_REDIS_REST_URL: "https://redis.example.com",
  UPSTASH_REDIS_REST_TOKEN: "token",
  RATE_LIMIT_HASH_SALT: "s".repeat(32),
  SENTRY_DSN: "https://key@sentry.io/1",
  ALERT_WEBHOOK_URL: "https://alerts.example.com/hook",
  BUDGET_DAILY_USD: "25",
  EMBEDDING_PROVIDER: "openai",
  EMBEDDING_MODEL: "text-embedding-3-large",
};

function problemKeys(env: EnvSource): string[] {
  return checkEnv(env).problems.map((p) => p.key);
}

describe("isProductionDeployment", () => {
  it("is true only for a Vercel production deployment", () => {
    expect(isProductionDeployment({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionDeployment({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isProductionDeployment({ NODE_ENV: "production" })).toBe(false);
    expect(isProductionDeployment({})).toBe(false);
  });
});

describe("checkEnv in production", () => {
  it("accepts a complete environment", () => {
    expect(checkEnv(PRODUCTION)).toMatchObject({ ok: true, problems: [] });
  });

  it.each([
    "DATABASE_URL",
    "OPENAI_API_KEY",
    "CRON_SECRET",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "RATE_LIMIT_HASH_SALT",
    "SENTRY_DSN",
    "ALERT_WEBHOOK_URL",
    "BUDGET_DAILY_USD",
    "EMBEDDING_PROVIDER",
    "EMBEDDING_MODEL",
  ])("refuses a deployment missing %s", (key) => {
    const env = { ...PRODUCTION };
    delete env[key];
    expect(problemKeys(env)).toContain(key);
  });

  it("reports every problem at once rather than the first", () => {
    const env = { ...PRODUCTION };
    delete env.SENTRY_DSN;
    delete env.ALERT_WEBHOOK_URL;
    delete env.BUDGET_DAILY_USD;
    expect(checkEnv(env).problems).toHaveLength(3);
  });

  it("explains why each one matters, so the deploy log is actionable", () => {
    const env = { ...PRODUCTION };
    delete env.RATE_LIMIT_HASH_SALT;
    const [problem] = checkEnv(env).problems;
    expect(problem.message).toMatch(/Upstash token/);
  });

  it("refuses the local admin bypass outright", () => {
    expect(
      problemKeys({ ...PRODUCTION, ALLOW_INSECURE_DEV_ADMIN: "true" }),
    ).toContain("ALLOW_INSECURE_DEV_ADMIN");
    expect(
      checkEnv({ ...PRODUCTION, ALLOW_INSECURE_DEV_ADMIN: "false" }).ok,
    ).toBe(true);
  });

  it("treats an empty string as absent, not as a value", () => {
    // Vercel returns "" for a variable that exists but was never given a value.
    expect(problemKeys({ ...PRODUCTION, SENTRY_DSN: "" })).toContain("SENTRY_DSN");
  });
});

describe("checkEnv shape validation", () => {
  it.each([
    ["a short cron secret", { CRON_SECRET: "tooshort" }],
    ["a short hash salt", { RATE_LIMIT_HASH_SALT: "tooshort" }],
    ["a non-HTTPS Upstash URL", { UPSTASH_REDIS_REST_URL: "http://redis.example.com" }],
    ["a non-HTTPS alert webhook", { ALERT_WEBHOOK_URL: "http://alerts.example.com" }],
    ["an unknown embedding provider", { EMBEDDING_PROVIDER: "cohere" }],
    ["a retention window beyond the promised cap", { DATA_RETENTION_DAYS: "90" }],
    ["a negative budget", { BUDGET_DAILY_USD: "-1" }],
    ["an out-of-range score threshold", { RAG_MIN_SCORE: "1.5" }],
  ])("rejects %s", (_label, override) => {
    expect(checkEnv({ ...PRODUCTION, ...override }).ok).toBe(false);
  });
});

describe("checkEnv outside production", () => {
  it("requires nothing locally, so development needs no Redis or Sentry", () => {
    expect(checkEnv({}).ok).toBe(true);
  });

  it("still enforces shape on whatever is set", () => {
    expect(checkEnv({ CRON_SECRET: "tooshort" }).ok).toBe(false);
  });

  it("does not enforce production requirements on a preview deploy", () => {
    expect(checkEnv({ VERCEL_ENV: "preview" }).ok).toBe(true);
  });
});

describe("formatEnvProblems", () => {
  it("renders one indented line per problem", () => {
    expect(formatEnvProblems([{ key: "A", message: "b" }])).toBe("  A: b");
  });
});
