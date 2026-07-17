import { isCronSecretConfigured } from "@/lib/privacy/cron";

export interface KnowledgeReadiness {
  ready: boolean;
  publishedItems: number;
  indexedItems: number;
}

/**
 * The answer and contract-vision paths both require an OpenAI key; without it
 * the app serves but every model call fails at runtime. Key-presence only — no
 * live provider call, so this stays cheap enough for a health probe.
 */
export function isInferenceConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

/**
 * Data retention runs from an authenticated cron; a missing/weak secret silently
 * disables it (the job 401s), so production is not ready without one. Outside
 * production the secret is optional.
 */
export function isRetentionConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV !== "production" || isCronSecretConfigured(env.CRON_SECRET);
}

/** Pure completeness check used by the readiness endpoint and unit tests. */
export function knowledgeReadiness(
  publishedIds: string[],
  indexedIds: string[],
): KnowledgeReadiness {
  const indexed = new Set(indexedIds);
  return {
    ready:
      publishedIds.length > 0 && publishedIds.every((id) => indexed.has(id)),
    publishedItems: publishedIds.length,
    indexedItems: new Set(indexedIds).size,
  };
}
