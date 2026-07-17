import { describe, expect, it } from "vitest";
import {
  knowledgeReadiness,
  isInferenceConfigured,
  isRetentionConfigured,
} from "@/lib/health/readiness";

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
