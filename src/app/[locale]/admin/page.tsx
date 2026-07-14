import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/content/auth";
import { listContent } from "@/lib/content/cms";
import { publishAction, reviewAction } from "./actions";

// Admin is English-only (for partner-NGO volunteers); it lives under [locale]
// so it inherits the root layout, but does not use translated strings.
const STATUS_STYLES: Record<string, string> = {
  draft: "bg-neutral-200 text-neutral-800",
  review: "bg-amber-200 text-amber-900",
  published: "bg-green-200 text-green-900",
  archived: "bg-neutral-100 text-neutral-400",
};

export default async function AdminPage() {
  await requireAdmin();

  let items: Awaited<ReturnType<typeof listContent>> = [];
  let dbError = false;
  try {
    items = await listContent();
  } catch {
    dbError = true;
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">MigraAid — Content admin</h1>
      <p className="text-sm text-neutral-500">
        Draft → review → publish. Publishing re-embeds the content so search stays
        in sync with what reviewers approved.
      </p>
      <Link href="/admin/kpi" className="text-sm text-blue-600 underline">
        View impact (KPIs) →
      </Link>

      {dbError ? (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
          Connect a database (set <code>DATABASE_URL</code>) to manage content.
        </p>
      ) : items.length === 0 ? (
        <p className="text-neutral-500">
          No content yet. Run <code>pnpm ingest</code> to seed the knowledge base.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between gap-3 rounded-xl border p-3"
            >
              <div>
                <p className="font-medium">{it.title}</p>
                <p className="text-xs text-neutral-500">
                  {it.domain} · {it.sourceRef}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-2 py-1 text-xs ${STATUS_STYLES[it.status] ?? ""}`}
                >
                  {it.status}
                </span>
                {it.status === "draft" && (
                  <form action={reviewAction}>
                    <input type="hidden" name="id" value={it.id} />
                    <button className="rounded border px-3 py-1 text-sm">
                      Send to review
                    </button>
                  </form>
                )}
                {it.status !== "published" && (
                  <form action={publishAction}>
                    <input type="hidden" name="id" value={it.id} />
                    <button className="rounded bg-green-600 px-3 py-1 text-sm text-white">
                      Publish
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
