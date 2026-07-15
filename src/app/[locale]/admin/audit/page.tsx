import { Link } from "@/i18n/navigation";
import { requireAdminPage } from "@/lib/content/auth";
import { listAudit } from "@/lib/content/cms";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAdminPage(locale, "reviewer");
  const entries = await listAudit();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <Link href="/admin" className="text-sm text-blue-600">← Admin</Link>
        <h1 className="text-2xl font-bold">Audit log</h1>
      </div>
      {entries.length === 0 ? (
        <p className="text-neutral-500">No governance activity recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-100">
              <tr><th className="p-3">When</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Entity</th></tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t">
                  <td className="whitespace-nowrap p-3">{entry.at.toISOString()}</td>
                  <td className="p-3">{entry.actor}</td>
                  <td className="p-3">{entry.action.replace(/_/g, " ")}</td>
                  <td className="p-3 font-mono text-xs">{entry.entityId ?? entry.entity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
