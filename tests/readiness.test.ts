import { describe, expect, it } from "vitest";
import {
  EXPECTED_MIGRATIONS,
  hasAllMigrationsApplied,
  knowledgeReadiness,
  isInferenceConfigured,
  isRetentionConfigured,
} from "@/lib/health/readiness";
import journal from "../drizzle/meta/_journal.json";

const env = (overrides: Record<string, string>) =>
  overrides as unknown as NodeJS.ProcessEnv;

describe("knowledge readiness", () => {
  it("requires at least one published item and current vectors for every item", () => {
    expect(knowledgeReadiness([], []).ready).toBe(false);
    expect(knowledgeReadiness(["a", "b"], ["a"]).ready).toBe(false);
    expect(knowledgeReadiness(["a", "b"], ["b", "a", "a"]).ready).toBe(true);
  });
});

describe("inference readiness", () => {
  it("is ready only when an OpenAI key is present", () => {
    expect(isInferenceConfigured(env({ OPENAI_API_KEY: "sk-test" }))).toBe(true);
    expect(isInferenceConfigured(env({}))).toBe(false);
  });
});

describe("migration readiness", () => {
  it("tracks the checked-in migration journal", () => {
    expect(EXPECTED_MIGRATIONS).toBe(journal.entries.length);
    expect(EXPECTED_MIGRATIONS).toBeGreaterThan(0);
  });

  it("reports a promoted build running ahead of the database as not ready", () => {
    expect(hasAllMigrationsApplied(EXPECTED_MIGRATIONS - 1)).toBe(false);
    expect(hasAllMigrationsApplied(EXPECTED_MIGRATIONS)).toBe(true);
    // A newer deploy may already have migrated further ahead; additive schema
    // with older code stays healthy.
    expect(hasAllMigrationsApplied(EXPECTED_MIGRATIONS + 1)).toBe(true);
  });

  it("fails closed on a missing or malformed count", () => {
    expect(hasAllMigrationsApplied(Number.NaN)).toBe(false);
    expect(hasAllMigrationsApplied(0)).toBe(false);
  });
});

describe("retention readiness", () => {
  const strong = "a-strong-cleanup-secret-with-32-characters";

  it("requires a strong cron secret in production", () => {
    expect(
      isRetentionConfigured(env({ NODE_ENV: "production", CRON_SECRET: strong })),
    ).toBe(true);
    expect(
      isRetentionConfigured(env({ NODE_ENV: "production", CRON_SECRET: "short" })),
    ).toBe(false);
    expect(isRetentionConfigured(env({ NODE_ENV: "production" }))).toBe(false);
  });

  it("does not require a cron secret outside production", () => {
    expect(isRetentionConfigured(env({ NODE_ENV: "test" }))).toBe(true);
    expect(isRetentionConfigured(env({ NODE_ENV: "development" }))).toBe(true);
  });
});
