# Operations

MigraAid is run by one person who sleeps, so it is built to protect itself and
tell you afterwards. This is what it does on its own, and what you do about it.

## The three states

| Mode | What works | What doesn't |
|---|---|---|
| `full` | everything | — |
| `degraded` | home, `/emergency`, referral directory, delete-my-data, offline PWA | `/api/chat`, `/api/contract` (both 503) |
| `off` | `/emergency` only | everything else |

`degraded` is deliberately still useful. A worker who cannot get an answer can
still get a phone number, which is the part that matters most anyway.

The app puts *itself* into `degraded` when any of these happen:

- today's spend reaches the daily ceiling;
- the ops store (Upstash) is unreachable and the cached flags are older than 60s;
- you set the flag by hand.

## Turning things off, right now

Everything lives in one Redis hash, `migraaid:flags`. No redeploy.

```bash
# Take the whole app down to emergency contacts only
curl -X POST "$UPSTASH_REDIS_REST_URL/hset/migraaid:flags/mode/off" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"

# Chat and contract off, referrals and emergency still up
curl -X POST "$UPSTASH_REDIS_REST_URL/hset/migraaid:flags/mode/degraded" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"

# Just the contract explainer
curl -X POST "$UPSTASH_REDIS_REST_URL/hset/migraaid:flags/contract/off" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"

# Back to normal
curl -X POST "$UPSTASH_REDIS_REST_URL/hset/migraaid:flags/mode/full" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
```

Changes take effect within 60 seconds — that is the window in which an instance
may still be serving a cached copy of the flags.

### Raising the ceiling

```bash
# Today's ceiling, in USD
curl -X POST "$UPSTASH_REDIS_REST_URL/hset/migraaid:flags/budget.daily_usd/100" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"

# Or ignore the ceiling entirely until a point in time
curl -X POST "$UPSTASH_REDIS_REST_URL/hset/migraaid:flags/budget.override_until/2026-07-29T00:00:00Z" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
```

**An override with no expiry is not possible on purpose.** A permanently
suspended ceiling is the same as no ceiling, and you will forget.

### Valid flag values

Anything unrecognised is ignored and the default applies, so a typo cannot take
the product down.

| Key | Values |
|---|---|
| `mode` | `full` · `degraded` · `off` |
| `chat`, `contract`, `feedback` | `off` (anything else means on) |
| `budget.daily_usd` | a positive number |
| `budget.override_until` | an ISO 8601 timestamp |
| `banner.key` | a message-catalog key, e.g. `common.maintenance` |

`banner.key` is a catalog key, never free text — the flag store can only show
workers copy that has already been written and translated.

## Checking on it

```bash
curl -s https://migraaid.sg/api/health/ready | jq
# {"status":"ready","mode":"full"}

# With detail — which check failed, spend, gate tier, disabled features
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://migraaid.sg/api/health/ready?verbose=1" | jq
```

`status` is `not_ready` whenever the mode is not `full`, so a platform health
gate sheds traffic without anyone intervening.

## Alerts

One message per event per day to `ALERT_WEBHOOK_URL`, on transitions only:

| Event | Means |
|---|---|
| `budget-soft` | 70% of the daily ceiling; contract explainer is now off |
| `budget-hard` | ceiling reached; app is degraded |
| `budget-panic` | 150% of the ceiling — investigate, this should not happen |
| `limiter-degraded:postgres` | Upstash unreachable, serving from the Postgres tier |
| `limiter-degraded:unavailable` | nothing reachable; generative routes are refusing |

Every alert also goes to `console.error` before Sentry is consulted, so a Vercel
log drain catches them even with no Sentry project.

**If alerts stop entirely, that is itself the signal.** Nothing heartbeats.

## When something is wrong

**Bill running away.** Check `?verbose=1` for `budgetState` and `spentUsd`. The
ceiling should already have degraded the app; if it has not, Upstash is probably
unreachable — set `mode=degraded` by hand, then look at Upstash.

**Everything 503s and you did not do it.** Almost certainly the ops store. Check
Upstash, then `?verbose=1` for `gateSource`: `postgres` means the fallback tier
is holding, `unavailable` means it is not.

**Answers all say "not enough verified information".** The index is empty or in
the wrong vector space. `?verbose=1` gives `publishedItems` and `unindexedItems`;
if `unindexedItems > 0` the embedder configuration changed without a re-ingest.
Run `pnpm ingest` (see the write guard note below).

**Deploy failed on the env check.** The message names each missing variable and
why it matters. Set it in Vercel project settings, Production scope, redeploy.

## Writing to production

`pnpm ingest` and `pnpm content:rollback` refuse a non-local database unless you
say so explicitly:

```bash
MIGRAAID_ALLOW_REMOTE_WRITE=1 pnpm ingest
```

Note that `scripts/env.ts` loads `.env.local` with `override: true`, so a
`DATABASE_URL` set on the command line **does not take effect**. Edit
`.env.local`, or use the flag above knowingly.

`pnpm content:rollback` archives every repository-managed item and deletes its
vectors, returning the assistant to refusing every question — the safe state. It
is reversible: edit a file and re-ingest.

## Routine

| When | What |
|---|---|
| Monthly | `pnpm sources:check` — a scheduled job runs this and opens an issue on drift |
| Monthly | Re-verify the emergency numbers in `src/lib/referral/emergency.ts` against each organisation's own site |
| Before a release | `pnpm eval` and `pnpm eval:offline` |
| Quarterly | Rotate `CRON_SECRET` and the Upstash token. `RATE_LIMIT_HASH_SALT` is separate on purpose — rotating it invalidates every rate-limit bucket and privacy tombstone at once, so rotate it alone and deliberately |
