import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/content/auth";
import { listReferrals } from "@/lib/referral/admin";
import { confirmReferralAction } from "../actions";

export default async function ReferralsPage() {
  await requireAdmin();

  let items: Awaited<ReturnType<typeof listReferrals>> = [];
  let dbError = false;
  try {
    items = await listReferrals();
  } catch {
    dbError = true;
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <Link href="/admin" className="text-sm text-blue-600">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold">Referrals</h1>
      </div>
      <p className="text-sm text-neutral-500">
        Mark a referral confirmed once a partner NGO has followed up. Confirmed
        referrals count toward the impact KPI.
      </p>

      {dbError ? (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
          Connect a database (set <code>DATABASE_URL</code>) to manage referrals.
        </p>
      ) : items.length === 0 ? (
        <p className="text-neutral-500">No referrals yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-xl border p-3"
            >
              <div>
                <p className="font-medium">{r.issueType.replace(/_/g, " ")}</p>
                <p className="text-xs text-neutral-500">{r.org}</p>
              </div>
              {r.confirmedByNgo ? (
                <span className="rounded bg-green-200 px-2 py-1 text-xs text-green-900">
                  confirmed
                </span>
              ) : (
                <form action={confirmReferralAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="rounded bg-green-600 px-3 py-1 text-sm text-white">
                    Mark confirmed
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
