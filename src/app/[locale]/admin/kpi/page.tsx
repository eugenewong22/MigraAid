import { requireAdminPage } from "@/lib/content/auth";
import { getKpis, type Kpis } from "@/lib/analytics/kpi";

// Fellowship targets.
const TARGETS = {
  uniqueUsers: 100,
  conversations: 500,
  contractsExplained: 50,
  confirmedReferrals: 30,
};

function Stat({
  label,
  value,
  target,
}: {
  label: string;
  value: number;
  target: number;
}) {
  const pct = Math.min(100, Math.round((value / target) * 100));
  return (
    <div className="rounded-xl border p-4">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="text-2xl font-bold">
        {value}
        <span className="text-base font-normal text-neutral-400">
          {" "}
          / {target}
        </span>
      </p>
      <div className="mt-2 h-2 w-full rounded bg-neutral-200">
        <div
          className="h-2 rounded bg-blue-600"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default async function KpiPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireAdminPage(locale);

  let kpis: Kpis | null = null;
  let dbError = false;
  try {
    kpis = await getKpis();
  } catch {
    dbError = true;
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">MigraAid — Impact (KPIs)</h1>

      {dbError || !kpis ? (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
          Connect a database (set <code>DATABASE_URL</code>) to see impact metrics.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Unique workers"
              value={kpis.uniqueUsers}
              target={TARGETS.uniqueUsers}
            />
            <Stat
              label="Conversations"
              value={kpis.conversations}
              target={TARGETS.conversations}
            />
            <Stat
              label="Contracts explained"
              value={kpis.contractsExplained}
              target={TARGETS.contractsExplained}
            />
            <Stat
              label="Confirmed referrals"
              value={kpis.confirmedReferrals}
              target={TARGETS.confirmedReferrals}
            />
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-neutral-500">Satisfaction (target 80%)</p>
            <p className="text-2xl font-bold">
              {kpis.satisfactionRate != null
                ? `${Math.round(kpis.satisfactionRate * 100)}%`
                : "—"}
              <span className="text-base font-normal text-neutral-400">
                {kpis.avgSatisfaction != null
                  ? ` (${kpis.avgSatisfaction.toFixed(1)}/5)`
                  : ""}
              </span>
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-neutral-500">Recorded LLM tokens</p>
            <p className="text-2xl font-bold">{kpis.totalLlmTokens.toLocaleString()}</p>
          </div>
        </>
      )}
    </main>
  );
}
