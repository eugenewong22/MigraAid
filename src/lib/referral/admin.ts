/**
 * Admin-side referral management. A partner NGO marks a referral confirmed once
 * they've followed up — that flag is what the "confirmed referrals" KPI counts.
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { referrals } from "@/lib/db/schema";
import { writeAudit } from "@/lib/content/cms";

export async function listReferrals() {
  return getDb().select().from(referrals).orderBy(desc(referrals.createdAt));
}

export async function confirmReferral(id: string, actor: string) {
  await getDb()
    .update(referrals)
    .set({ confirmedByNgo: true, outcome: "confirmed" })
    .where(eq(referrals.id, id));
  await writeAudit(actor, "confirm_referral", "referral", id);
}
