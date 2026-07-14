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
3. Copy the **transaction-pooled** connection string into `DATABASE_URL` (serverless-friendly).
4. Apply the schema:
   ```bash
   pnpm db:push        # or: pnpm db:generate && pnpm db:migrate
   ```

## 2. API keys

| Variable | Where to get it | Needed for |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com | Chat answers, contract vision (M1/M3) |
| `VOYAGE_API_KEY` | voyageai.com | Multilingual embeddings for retrieval (M1) |
| `DATABASE_URL` | Supabase | Everything data-backed |
| `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Admin auth (M5) |
| `SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `LANGFUSE_*` | respective dashboards | Observability (M6, optional) |

Copy `.env.example` → `.env.local` for local dev; set the same variables in the Vercel project
settings for production.

## 3. Deploy to Vercel

1. Push the repo to GitHub.
2. Import it in Vercel (framework auto-detected as Next.js).
3. Add the environment variables above.
4. Deploy. Vercel gives every pull request a preview URL; the GitHub Actions workflow
   (`.github/workflows/ci.yml`) runs typecheck + tests + lint on each PR.

## 4. Budget notes

- **Prompt caching** (the frozen system prompt + retrieved sources) keeps per-turn LLM cost low —
  cache reads are ~0.1× input price.
- **Model tiering** is the main scale lever: routine RAG turns can run on a smaller Claude model,
  with the strongest model reserved for the contract explainer and high-stakes cases.
- At pilot scale, total cost is roughly **$75–165/month**.
