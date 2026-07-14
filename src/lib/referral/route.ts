/**
 * Referral engine — data-driven routing from an issue type to the right
 * organisation, agency, or embassy. Full implementation (DB-backed org lookup +
 * a `create_referral` tool the chatbot can call) lands in M4; the type contract
 * and the static issue→org map live here now.
 */
import type { Domain } from "@/lib/rag/types";

export interface ReferralTarget {
  org: string;
  contact: string;
  reason: string;
}

export interface ReferralRequest {
  issueType: string;
  domain?: Domain;
  locale: string;
}

/**
 * Baseline static routing table. In M4 this is replaced/augmented by the `orgs`
 * table so partner NGOs can maintain it via the admin CMS.
 */
export const ISSUE_TO_ORG: Record<string, string> = {
  unpaid_salary: "TADM (Tripartite Alliance for Dispute Management)",
  workplace_injury: "MOM (WICA) / HOME",
  wrongful_dismissal: "TADM / HOME",
  contract_dispute: "MOM / TWC2",
  abuse_or_threats: "Police (999) / HOME",
  housing: "MOM / HOME",
  healthcare: "HealthServe",
  financial: "TWC2 / HOME",
};

/** Placeholder resolver — real DB-backed routing arrives in M4. */
export async function routeReferral(
  _req: ReferralRequest,
): Promise<ReferralTarget[]> {
  throw new Error("routeReferral is implemented in M4 (referral engine)");
}
