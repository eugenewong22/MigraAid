export interface KnowledgeReadiness {
  ready: boolean;
  publishedItems: number;
  indexedItems: number;
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
