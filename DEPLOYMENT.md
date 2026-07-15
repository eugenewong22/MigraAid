# Deploying MigraAid

MigraAid is a single Next.js app plus a Postgres/pgvector database. The recommended low-ops setup
is **Vercel** (app) + **Supabase** (Postgres + pgvector + admin Auth), which fits comfortably in a
~$200/month budget at the fellowship's pilot scale.

## 1. Database (Supabase / any Postgres with pgvector)

1. Create a Supabase project (or any Postgres 15+).
2. Enable the vector extension:
   ```sql
   create extension if not exists vector;
   ```
3. Create separate credentials. Put a direct/table-owner connection in
   `MIGRATION_DATABASE_URL` for trusted release jobs only. Put a transaction-pooled,
   DML-only connection in runtime `DATABASE_URL`. On Supabase these are the same
   pooler host on different ports: `DATABASE_URL` uses the **transaction pooler
   (port 6543)**, `MIGRATION_DATABASE_URL` must use the **session pooler (port
   5432)** — drizzle-kit migrations hold advisory locks and run `DO $$` blocks
   that the transaction pooler cannot service. The runtime role must be allowed
   through the default-deny RLS boundary (for example a dedicated `BYPASSRLS`
   application role), but must not own tables or have schema/DDL privileges.
4. Apply every checked-in migration, including the custom default-deny RLS migration:
   ```bash
   pnpm db:migrate
   ```
   Do not use `db:push` for production provisioning: it synchronises the Drizzle
   schema but does not apply custom security migrations. Run migrations only in
   the trusted release environment with `MIGRATION_DATABASE_URL`; browser-facing
   Supabase `anon` and `authenticated` roles intentionally have no table access.

   This manual run covers first provisioning. After that, every **production**
   Vercel deploy applies pending migrations automatically: the `vercel-build`
   script runs `scripts/release/migrate.ts` before `next build`, and fails the
   deploy if `MIGRATION_DATABASE_URL` is missing or points at the transaction
   pooler. Code therefore never ships ahead of the schema — a route querying a
   column its database doesn't have yet is a full outage, and this is the gate
   that prevents it. Preview builds skip migrations by design.
5. Have a partner NGO review each checked-in knowledge document and add the
   required publication metadata described in `content/README.md`. Do not
   fabricate reviewer names or dates for the illustrative seed corpus.
6. Run `pnpm ingest` before sending traffic to the new release. The ingester
   stores any unreviewed or malformed repository content as `draft` and removes
   legacy vectors for it; only explicitly reviewed `published` files are indexed.
   Treat a run reporting unverified drafts as a launch blocker for the affected
   guidance. Migration 0002 marks pre-existing vectors as `legacy`, and retrieval
   intentionally ignores them until they are regenerated in the configured
   provider/model vector space. Keep the embedding provider configuration stable;
   rerun ingestion whenever it changes.
7. Require `GET /api/health/ready` to return 200 before routing traffic. It
   verifies the migrated database is reachable and every published item has
   chunks in the currently configured embedding vector space.

## 2. API keys

| Variable | Where to get it | Needed for |
|---|---|---|
| `OPENAI_API_KEY` | platform.openai.com | Chat answers, contract vision, embedding fallback |
| `VOYAGE_API_KEY` | voyageai.com | Preferred multilingual embeddings (optional) |
| `DATABASE_URL` | Supabase | Everything data-backed |
| `MIGRATION_DATABASE_URL` | Supabase/direct Postgres | Release-time migrations only; never the app runtime |
| `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` | Supabase | Admin auth |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Sentry | Privacy-sanitized server/client error reporting (optional) |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Sentry | Source-map upload during production builds (optional) |
| `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_HOST` | PostHog/self-hosted | Person-profile-free aggregate events with unlinkable per-event IDs (optional) |
| `LANGFUSE_*` | Langfuse | LLM tracing (not yet wired) |
| `UPSTASH_REDIS_REST_URL`, `..._TOKEN`, `RATE_LIMIT_HASH_SALT` | Upstash Redis | Fleet-wide API rate limiting (required for production admin sign-in) |

Copy `.env.example` → `.env.local` for local dev; set the same variables in the Vercel project
settings for production.

### Admin roles

Create NGO volunteer accounts in Supabase Auth, then assign one of these roles in the user's
trusted `app_metadata.role`: `author`, `reviewer`, or `admin`. Authors can create and submit drafts;
reviewers/admins can publish and confirm referrals. User metadata is not accepted for roles.

Admin authentication fails closed when Supabase is not configured. For local-only UI work,
`ALLOW_INSECURE_DEV_ADMIN=true` enables an administrator bypass only when `NODE_ENV` is not
`production` and the Supabase variables are absent. Never set this variable on Vercel, a preview,
or any network-accessible deployment; production ignores it even if it is accidentally present.
Production admin sign-in also fails closed unless the distributed Upstash limiter
responds, so configure the rate-limit variables before inviting volunteers.

### Retention

Set `DATA_RETENTION_DAYS` (30 by default, hard-capped at 90) and a random
32-character-or-longer `CRON_SECRET`. `vercel.json` invokes the authenticated
cleanup route daily; an external scheduler can instead call
`POST /api/cron/privacy-cleanup` with `Authorization: Bearer <CRON_SECRET>`.
Alert on non-2xx cron responses. Workers can request immediate session-scoped
deletion through `DELETE /api/privacy`.

Contract photos are sent inline to the OpenAI Chat Completions API and are never
written to MigraAid's filesystem or database. The requests explicitly set
`store: false`; however, OpenAI's default abuse-monitoring logs may still retain
API customer content for up to 30 days. Before a worker pilot, review the current
provider data controls and seek approval for Zero Data Retention or Modified Abuse
Monitoring where available. Keep the in-product disclosure aligned with the
deployed provider and project controls.

Emergency and referral contacts are static for offline access. Re-verify them against their official
organisation websites before each public release; the current set was checked on 14 July 2026.

## 3. Deploy to Vercel

1. Push the repo to GitHub.
2. Import it in Vercel (framework auto-detected as Next.js).
3. Add the environment variables above. Set `MIGRATION_DATABASE_URL` in the
   **Production** environment only — production builds refuse to deploy without
   it, and preview builds must not hold a DDL-capable credential.
4. Deploy. Vercel runs the `vercel-build` script, which applies pending database
   migrations before building (see section 1), so the schema is always in place
   before new code serves traffic. Every pull request gets a preview URL; the
   GitHub Actions workflow (`.github/workflows/ci.yml`) runs typecheck + tests +
   lint on each PR.

## 4. Budget notes

- **Model tiering** is the main scale lever: routine RAG turns can run on a smaller model, with the
  strongest model reserved for contract explanation and difficult cases.
- At pilot scale, total cost is roughly **$75–165/month**.
