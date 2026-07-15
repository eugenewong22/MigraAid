# MigraAid

**An AI-powered, multilingual support hub for migrant workers in Singapore.**

MigraAid gives low-wage migrant workers instant, source-grounded guidance — in their own
language — on employment rights, healthcare, housing, financial literacy, and settlement/admin.
It also explains employment contracts, routes workers to the right NGO/agency, and gives partner
NGOs a simple admin panel to keep the content accurate.

It is designed for a vulnerable audience, so three things are treated as non-negotiable:

- **Safety** — every substantive answer is grounded in verified sources and cited; high-stakes or
  uncertain questions escalate to a human. It provides information, never legal advice.
- **Privacy** — anonymous by default (no worker login), minimal/retention-bound data, and uploaded
  contract images are never stored by MigraAid. Provider-side API safety retention is disclosed.
- **Access** — mobile-first, low-bandwidth, large tap targets, and eight languages: English,
  Bengali, Tamil, Tagalog, Mandarin, Bahasa Indonesia, Thai, and Burmese.

> Open-source so partner NGOs and civic-tech groups can fork, run, and maintain it.

## Tech stack

Next.js (App Router, TypeScript) · OpenAI API (answers and contract vision) ·
Voyage AI embeddings · Postgres + pgvector (Supabase) · Drizzle ORM · next-intl · Tailwind ·
Vercel. See `ARCHITECTURE` notes inline in `src/lib/*`.

## Roadmap (milestones)

| Milestone | Status | Scope |
|---|---|---|
| **M0** Scaffold & infra | ✅ done | App, versioned DB migrations, module boundaries, i18n, tests, CI |
| **M1** RAG core (English) | ✅ code (add keys to run) | Ingestion, pgvector retrieval, streamed **cited** answers, safety policy, eval |
| **M2** Multilingual (8 langs) | ✅ UI + i18n | 8 parity-tested catalogs, native-script switcher; answers localized at runtime; native-speaker QA pending |
| **M3** Contract explainer | ✅ code (add keys to run) | Vision → flagged clauses; explicit derived-result retention opt-in; no image stored by MigraAid |
| **M4** Referrals + emergency | ✅ done | Data-driven routing + emergency directory + installable PWA |
| **M5** Admin CMS | ✅ code (add DB+auth) | Draft→review→publish→re-embed governance + audit log |
| **M6** Hardening + launch | ⏳ partial | ✅ RLS/RBAC, safety gates, fleet-wide rate limiting, privacy controls, Sentry, unlinkable PostHog events, KPI dashboard, safe offline pages · remaining: NGO/native-speaker QA, browser E2E/load tests, provider data-control approval, public beta |

## Quick start

```bash
pnpm install
cp .env.example .env.local   # fill in the values you have (see DEPLOYMENT.md)
pnpm dev                     # http://localhost:3000
```

The app runs without any external services for the shell/UI. RAG answers need `OPENAI_API_KEY`
+ a `DATABASE_URL` (Postgres with the `pgvector` extension); `VOYAGE_API_KEY` is optional but
preferred for multilingual retrieval. See
[DEPLOYMENT.md](./DEPLOYMENT.md).

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Run the dev server |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm lint` | ESLint |
| `pnpm db:generate` / `pnpm db:migrate` | Generate/apply versioned Drizzle migrations |
| `pnpm db:push` | Local schema prototyping only; it does not apply custom RLS SQL |
| `pnpm ingest` | Idempotently reindex the checked-in knowledge corpus |
| `pnpm eval` | Run live retrieval/answer golden-set checks (requires services) |
| `pnpm privacy:cleanup` | Delete linkable worker data older than `DATA_RETENTION_DAYS` |

Worker data can also be deleted immediately with `DELETE /api/privacy`; the
request is scoped to the caller's opaque HttpOnly session cookie.

The home page exposes this deletion control in all eight supported languages.

## Project layout

```
src/
  app/[locale]/        Localized worker UI plus authenticated admin routes
  components/          Shared UI (e.g. LocaleSwitcher)
  i18n/                next-intl routing, request config, navigation
  lib/
    db/                Drizzle schema + client (Postgres + pgvector)
    embeddings/        Provider-agnostic multilingual embeddings (Voyage default)
    safety/            System prompt, disclaimer, escalation policy
    rag/               Generation-aware retrieval and citation-gated answers
    contract/          Ephemeral image analysis and storage-consent policy
    referral/          Issue → support-organisation routing
    analytics/         DB KPI rollups and unlinkable aggregate events
messages/              One JSON catalog per locale
tests/                 Vitest
```

## License

MIT — see [LICENSE](./LICENSE).
