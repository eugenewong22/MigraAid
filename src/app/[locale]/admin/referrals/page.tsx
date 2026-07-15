import { Link } from "@/i18n/navigation";
import { requireAdminPage } from "@/lib/content/auth";
import { listReferrals } from "@/lib/referral/admin";
import { confirmReferralAction } from "../actions";

export default async function ReferralsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireAdminPage(locale, "reviewer");

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
        A recommendation is not a confirmed referral. After real contact, ask
        the worker for the private handoff code shown in MigraAid and enter it
        below. The code is never stored in readable form.
      </p>

      <form action={confirmReferralAction} className="flex flex-col gap-2 rounded-xl border p-4">
        <label htmlFor="handoff-code" className="text-sm font-semibold">
          Worker handoff code
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="handoff-code"
            name="code"
            required
            autoComplete="off"
            placeholder="MA-XXXX-XXXX-XXXX"
            className="min-w-64 flex-1 rounded border px-3 py-2 font-mono uppercase"
          />
          <button className="rounded bg-green-700 px-4 py-2 font-semibold text-white">
            Confirm contacted referral
          </button>
        </div>
      </form>

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
                <p className="text-xs text-neutral-500">
                  Created {r.createdAt.toLocaleDateString("en-SG")} · code expires{" "}
                  {r.expiresAt.toLocaleDateString("en-SG")}
                </p>
              </div>
              {r.confirmedByNgo ? (
                <div className="text-right text-xs">
                  <span className="rounded bg-green-200 px-2 py-1 text-green-900">
                    confirmed
                  </span>
                  {r.confirmedAt && (
                    <p className="mt-1 text-neutral-500">
                      {r.confirmedAt.toLocaleDateString("en-SG")}
                    </p>
                  )}
                </div>
              ) : (
                <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
                  recommendation shown
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
