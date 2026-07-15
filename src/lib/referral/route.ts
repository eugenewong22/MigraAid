/**
 * Referral engine — data-driven routing from an issue type to the right
 * organisation. Static config for M4; in M5 the admin CMS lets partner NGOs
 * maintain the org list (and this reads from the `orgs` table).
 *
 * `referralTargets` is pure and unit-tested; `routeReferral` keeps the async
 * signature so a DB-backed implementation can drop in without changing callers.
 */
import type { Domain } from "@/lib/rag/types";

export interface ReferralTarget {
  org: string;
  contact: string;
  href?: string;
  reason: string;
}

export interface ReferralRequest {
  issueType: string;
  domain?: Domain;
  locale: string;
}

interface OrgInfo {
  name: string;
  contact: string;
  href?: string;
}

/** Referral targets verified against organisation/government sites on 2026-07-14. */
const ORGS: Record<string, OrgInfo> = {
  tadm: {
    name: "TADM — Tripartite Alliance for Dispute Management",
    contact: "Open TADM eServices",
    href: "https://www.tal.sg/tadm/eservices",
  },
  mom: { name: "MOM — Ministry of Manpower", contact: "+65 6438 5122" },
  home: {
    name: "HOME — Humanitarian Organisation for Migration Economics",
    contact: "+65 6341 5535",
  },
  twc2: { name: "TWC2 — Transient Workers Count Too", contact: "1800 888 1515" },
  healthserve: { name: "HealthServe", contact: "+65 3129 5000" },
  police: { name: "Police (emergency)", contact: "999" },
};

const ISSUE_TO_ORGS: Record<string, string[]> = {
  unpaid_salary: ["tadm", "home"],
  workplace_injury: ["mom", "home"],
  wrongful_dismissal: ["tadm", "home"],
  contract_dispute: ["mom", "twc2"],
  abuse_or_threats: ["police", "home"],
  housing: ["mom", "home"],
  healthcare: ["healthserve"],
  financial: ["twc2", "home"],
  immigration_status: ["mom", "home"],
  repatriation: ["mom", "home"],
};

/** Pure resolver: issue type → ordered list of referral targets (defaults to HOME). */
export function referralTargets(issueType: string): ReferralTarget[] {
  const keys = ISSUE_TO_ORGS[issueType] ?? ["home"];
  return keys.map((key) => {
    const org = ORGS[key];
    return {
      org: org.name,
      contact: org.contact,
      href: org.href,
      reason: `Support for ${issueType.replace(/_/g, " ")}`,
    };
  });
}

export async function routeReferral(
  req: ReferralRequest,
): Promise<ReferralTarget[]> {
  return referralTargets(req.issueType);
}
