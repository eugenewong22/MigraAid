/**
 * Admin-side referral management. A partner NGO must provide the private code
 * shown to the worker; merely seeing a recommendation cannot increment the KPI.
 */
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, referrals } from "@/lib/db/schema";
import { IMPACT_METRICS, incrementMetric } from "@/lib/analytics/metrics";
import { hashHandoffCode } from "./handoff";

export async function listReferrals() {
  return getDb()
    .select({
      id: referrals.id,
      issueType: referrals.issueType,
      org: referrals.org,
      outcome: referrals.outcome,
      confirmedByNgo: referrals.confirmedByNgo,
      confirmedAt: referrals.confirmedAt,
      confirmedBy: referrals.confirmedBy,
      expiresAt: referrals.expiresAt,
      createdAt: referrals.createdAt,
    })
    .from(referrals)
    .orderBy(desc(referrals.createdAt))
    .limit(200);
}

export async function confirmReferral(code: string, actorId: string) {
  const codeHash = hashHandoffCode(code);
  const now = new Date();
  return getDb().transaction(async (tx) => {
    const [confirmed] = await tx
      .update(referrals)
      .set({
        confirmedByNgo: true,
        confirmedAt: now,
        confirmedBy: actorId,
        outcome: "confirmed",
      })
      .where(
        and(
          eq(referrals.handoffCodeHash, codeHash),
          eq(referrals.confirmedByNgo, false),
          gt(referrals.expiresAt, now),
        ),
      )
      .returning({ id: referrals.id });
    if (!confirmed) {
      throw new Error("Referral code is invalid, expired, or already confirmed");
    }

    await tx.insert(auditLog).values({
      actor: actorId,
      action: "confirm_referral",
      entity: "referral",
      entityId: confirmed.id,
      metadata: { method: "worker_handoff_code" },
    });
    await incrementMetric(IMPACT_METRICS.confirmedReferrals, {
      now,
      database: tx,
    });
    return confirmed;
  });
}
