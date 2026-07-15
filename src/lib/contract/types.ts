/**
 * Contract explainer types. The vision implementation returns structured output
 * from lib/contract/analyze.ts.
 *
 * Privacy: the uploaded image is processed in-memory and never persisted. Only
 * this derived analysis may be stored (see db/schema `contract_reviews`).
 */

export type ClauseSeverity = "info" | "warning" | "serious";

export interface FlaggedClause {
  /** Short quote or paraphrase of the clause. */
  clause: string;
  /** Why it may disadvantage the worker, in plain language. */
  concern: string;
  severity: ClauseSeverity;
}

export interface ContractAnalysis {
  /** Plain-language summary in the worker's language. */
  summary: string;
  /** Key terms extracted (salary, hours, notice period, etc.). */
  keyTerms: Array<{ label: string; value: string }>;
  flaggedClauses: FlaggedClause[];
}
