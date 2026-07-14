# MigraAid

**An AI-powered, multilingual support hub for migrant workers in Singapore.**

MigraAid gives low-wage migrant workers instant, source-grounded guidance — in their own
language — on employment rights, healthcare, housing, financial literacy, and settlement/admin.
It also explains employment contracts, routes workers to the right NGO/agency, and gives partner
NGOs a simple admin panel to keep the content accurate.

It is designed for a vulnerable audience, so three things are treated as non-negotiable:

- **Safety** — every substantive answer is grounded in verified sources and cited; high-stakes or
  uncertain questions escalate to a human. It provides information, never legal advice.
- **Privacy** — anonymous by default (no worker login), minimal data, and uploaded contract images
  are never stored.
- **Access** — mobile-first, low-bandwidth, large tap targets, and eight languages: English,
  Bengali, Tamil, Tagalog, Mandarin, Bahasa Indonesia, Thai, and Burmese.

> Open-source so partner NGOs and civic-tech groups can fork, run, and maintain it.

## Tech stack

Next.js (App Router, TypeScript) · Claude API (answers, contract vision, citations) ·
Voyage AI embeddings · Postgres + pgvector (Supabase) · Drizzle ORM · next-intl · Tailwind ·
Vercel. See `ARCHITECTURE` notes inline in `src/lib/*`.

## Roadmap (milestones)

| Milestone | Status | Scope |
|---|---|---|
| **M0** Scaffold & infra | ✅ done | App, data model, module boundaries, i18n, tests, CI |
| **M1** RAG core (English) | ✅ code (add keys to run) | Ingestion, pgvector retrieval, streamed **cited** answers, safety policy, eval |
| **M2** Multilingual (8 langs) | ✅ UI + i18n (translations draft) | 8 catalogs, native-script switcher; answers localized at runtime; native QA pending |
| **M3** Contract explainer | ✅ code (add keys to run) | Claude vision → flagged clauses (ephemeral, no image stored) |
| **M4** Referrals + emergency | ✅ done | Data-driven routing + emergency directory + installable PWA |
| **M5** Admin CMS | ✅ code (add DB+auth) | Draft→review→publish→re-embed governance + audit log |
| **M6** Hardening + launch | remaining | KPI dashboard, rate limiting, red-team, offline SW, icons, public beta |

## Quick start

```bash
pnpm install
cp .env.example .env.local   # fill in the values you have (see DEPLOYMENT.md)
pnpm dev                     # http://localhost:3000
```

The app runs without any external services for the shell/UI. RAG answers need `ANTHROPIC_API_KEY`
+ `VOYAGE_API_KEY` + a `DATABASE_URL` (Postgres with the `pgvector` extension). See
[DEPLOYMENT.md](./DEPLOYMENT.md).

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Run the dev server |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm lint` | ESLint |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:push` | Drizzle migrations |

## Project layout

```
src/
  app/[locale]/        Localized routes (worker UI; /admin lands in M5)
  components/          Shared UI (e.g. LocaleSwitcher)
  i18n/                next-intl routing, request config, navigation
  lib/
    db/                Drizzle schema + client (Postgres + pgvector)
    embeddings/        Provider-agnostic multilingual embeddings (Voyage default)
    safety/            System prompt, disclaimer, escalation policy
    rag/               Retrieve + answer (types now; impl in M1)
    contract/          Contract-explainer types (impl in M3)
    referral/          Issue → org routing (impl in M4)
    analytics/         Privacy-safe KPI events (provider wired in M6)
messages/              One JSON catalog per locale
tests/                 Vitest
```

## License

MIT — see [LICENSE](./LICENSE).
