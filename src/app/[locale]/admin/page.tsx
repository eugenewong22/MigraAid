import { Link } from "@/i18n/navigation";
import { requireAdminPage } from "@/lib/content/auth";
import { listContent } from "@/lib/content/cms";
import {
  archiveAction,
  createDraftAction,
  publishAction,
  requestChangesAction,
  reviewAction,
  updateDraftAction,
} from "./actions";

// Admin is English-only (for partner-NGO volunteers); it lives under [locale]
// so it inherits the root layout, but does not use translated strings.
const STATUS_STYLES: Record<string, string> = {
  draft: "bg-neutral-200 text-neutral-800",
  review: "bg-amber-200 text-amber-900",
  published: "bg-green-200 text-green-900",
  archived: "bg-neutral-100 text-neutral-400",
};

export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const principal = await requireAdminPage(locale);
  const canReview = principal.role === "reviewer" || principal.role === "admin";

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
      <div className="flex gap-4">
        <Link href="/admin/kpi" className="text-sm text-blue-600 underline">
          View impact (KPIs) →
        </Link>
        {canReview && (
          <Link href="/admin/referrals" className="text-sm text-blue-600 underline">
            Referrals →
          </Link>
        )}
        {canReview && (
          <Link href="/admin/audit" className="text-sm text-blue-600 underline">
            Audit log →
          </Link>
        )}
      </div>
      <div className="flex items-center justify-between text-sm text-neutral-500">
        <span>
          Signed in as {principal.email ?? principal.id} ({principal.role})
        </span>
        <form action="/api/admin/logout" method="post">
          <button className="underline">Sign out</button>
        </form>
      </div>

      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">Create knowledge-base draft</summary>
        <form action={createDraftAction} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Domain
            <select name="domain" required className="rounded-lg border px-3 py-2">
              <option value="legal_rights">Legal rights</option>
              <option value="healthcare">Healthcare</option>
              <option value="housing">Housing</option>
              <option value="financial">Financial</option>
              <option value="settlement">Settlement/admin</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Title
            <input name="title" required minLength={3} maxLength={200} className="rounded-lg border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Human-readable source reference
            <input name="sourceRef" required minLength={3} maxLength={500} className="rounded-lg border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Canonical HTTPS source URL (recommended)
            <input name="sourceUrl" type="url" maxLength={2000} className="rounded-lg border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Guidance (Markdown)
            <textarea name="bodyMd" required minLength={20} maxLength={50000} rows={8} className="rounded-lg border px-3 py-2" />
          </label>
          <button className="self-start rounded bg-blue-600 px-4 py-2 font-semibold text-white">Save draft</button>
        </form>
      </details>

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
              className="flex flex-col gap-3 rounded-xl border p-3"
            >
              <div className="min-w-0">
                <p className="font-medium">{it.title}</p>
                <p className="text-xs text-neutral-500">
                  {it.domain} · v{it.version} · {it.sourceRef}
                </p>
                {it.status === "draft" && it.reviewNote && (
                  <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
                    Reviewer requested changes: {it.reviewNote}
                  </p>
                )}
                {it.status === "draft" && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-blue-600">Edit draft</summary>
                    <form action={updateDraftAction} className="mt-2 flex flex-col gap-2">
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="version" value={it.version} />
                      <select name="domain" defaultValue={it.domain} className="rounded border px-2 py-1 text-sm">
                        <option value="legal_rights">Legal rights</option>
                        <option value="healthcare">Healthcare</option>
                        <option value="housing">Housing</option>
                        <option value="financial">Financial</option>
                        <option value="settlement">Settlement/admin</option>
                      </select>
                      <input name="title" defaultValue={it.title} required minLength={3} maxLength={200} className="rounded border px-2 py-1 text-sm" />
                      <input name="sourceRef" defaultValue={it.sourceRef} required minLength={3} maxLength={500} className="rounded border px-2 py-1 text-sm" />
                      <input
                        name="sourceUrl"
                        type="url"
                        defaultValue={it.sourceUrl ?? ""}
                        maxLength={2000}
                        placeholder="https://official-source.example/..."
                        className="rounded border px-2 py-1 text-sm"
                      />
                      <textarea name="bodyMd" defaultValue={it.bodyMd} required minLength={20} maxLength={50000} rows={6} className="rounded border px-2 py-1 text-sm" />
                      <button className="self-start rounded bg-blue-600 px-3 py-1 text-sm text-white">Save changes</button>
                    </form>
                  </details>
                )}
                {it.status === "review" && (
                  <section className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <h2 className="font-semibold text-amber-950">
                      Review exact version {it.version}
                    </h2>
                    <p className="mt-1 text-xs text-amber-900">
                      Submitted by immutable user id: {it.submittedBy ?? "unknown"}
                    </p>
                    {it.sourceUrl && (
                      <p className="mt-1 break-all text-xs">
                        Canonical source:{" "}
                        <a
                          href={it.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 underline"
                        >
                          {it.sourceUrl}
                        </a>
                      </p>
                    )}
                    <div className="mt-3 max-h-96 overflow-auto rounded border bg-white p-3 text-sm text-neutral-900">
                      <p className="mb-2 font-semibold">Full guidance body</p>
                      <div className="whitespace-pre-wrap break-words">{it.bodyMd}</div>
                    </div>
                  </section>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                {it.status === "review" &&
                  canReview &&
                  it.submittedBy !== principal.id &&
                  it.lastEditedBy !== principal.id && (
                  <form action={publishAction}>
                    <input type="hidden" name="id" value={it.id} />
                    <input type="hidden" name="version" value={it.version} />
                    <button className="rounded bg-green-600 px-3 py-1 text-sm text-white">
                      Approve and publish this version
                    </button>
                  </form>
                )}
                {it.status === "review" &&
                  canReview &&
                  it.submittedBy !== principal.id &&
                  it.lastEditedBy !== principal.id && (
                    <form action={requestChangesAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="version" value={it.version} />
                      <label className="sr-only" htmlFor={`review-note-${it.id}`}>
                        Required change reason
                      </label>
                      <input
                        id={`review-note-${it.id}`}
                        name="note"
                        required
                        minLength={3}
                        maxLength={2000}
                        placeholder="Required changes"
                        className="rounded border px-2 py-1 text-sm"
                      />
                      <button className="rounded border border-amber-500 px-3 py-1 text-sm text-amber-900">
                        Request changes
                      </button>
                    </form>
                  )}
                {it.status === "review" &&
                  canReview &&
                  (it.submittedBy === principal.id ||
                    it.lastEditedBy === principal.id) && (
                    <span className="text-xs text-amber-700">
                      Another reviewer must decide this submission.
                    </span>
                  )}
                {canReview && it.status !== "archived" && it.status !== "draft" && (
                  <form action={archiveAction}>
                    <input type="hidden" name="id" value={it.id} />
                    <button className="rounded border border-red-300 px-3 py-1 text-sm text-red-700">
                      Archive
                    </button>
                  </form>
                )}
                {it.status === "review" && !canReview && (
                  <span className="text-xs text-neutral-500">Awaiting reviewer</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
