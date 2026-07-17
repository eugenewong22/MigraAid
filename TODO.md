# MigraAid — Audit Findings To-Do

Generated from a 5-agent parallel audit (security, privacy/safety, backend correctness,
frontend/a11y/i18n, infra/tests) of branch `redesign/navy-editorial`. Every item cites
`file:line`. Two highest-impact claims (citation ordering, redirect-cookie immutability)
were independently re-verified.

Legend: 🔴 High · 🟡 Medium · 🟢 Low · **[redesign]** = regression introduced by the
Navy Editorial reskin, should probably land on PR #1 before merge.

---

## 🔴 High priority

- [ ] **Citation `[n]` markers don't align with the rendered source list** *(verified)*
      `src/lib/rag/answer.ts:276`, `src/components/Chat.tsx:263`
      `extractCitations` builds the citations array in first-appearance order and drops
      the marker number, but the answer text keeps literal `[3]`/`[1]`. A worker reading
      "[1]" maps it to the first listed source, which may actually be a different chunk —
      wrong legal attribution in the app's core path.
      Fix: carry `sourceNumber` into `Citation` and render numbered entries, or rewrite
      markers in `text` to sequential order matching the array.

- [ ] **Admin logout (and likely login) broken: cookie set on immutable redirect Response** *(verified)*
      `src/app/api/admin/logout/route.ts:9`, `src/app/api/admin/login/route.ts:107`
      `Response.redirect()` returns headers that are immutable — `.headers.set()` throws.
      Logout: uncaught throw → 500, cookie never cleared, admin session **survives
      sign-out** (shared-device risk). Login: throw is swallowed by try/catch → session
      cookie never set, every valid login bounces back as "invalid credentials". This path
      is untested (dev uses the insecure-dev bypass).
      Fix: `new Response(null, { status: 303, headers })` or `NextResponse.cookies.set()`.

- [ ] **The "safety gate" eval never runs automatically**
      `scripts/eval/run.ts:1`, `.github/workflows/ci.yml`
      The harness calls itself the shipping gate but CI only runs the deterministic-
      escalation subset (`tests/eval-golden.test.ts`). RAG quality/citation regressions in
      `eval/golden.json` ship silently.
      Fix: scheduled workflow against a seeded staging DB with secrets, or an explicit
      release-checklist gate that records the eval score.

- [ ] **[redesign] Chat log lost its scroll container — autoscroll is a no-op**
      `src/components/Chat.tsx:165`
      Pre-redesign had `max-h-[60dvh] overflow-y-auto overscroll-contain`; the reskin
      dropped these. `logRef.scrollTop = scrollHeight` now does nothing — streaming
      replies grow below the fold and the input drifts off-screen on phones.
      Fix: restore `max-h`/`overflow-y-auto` on the log div, or scroll `window` and make
      the input form sticky.

- [ ] **[redesign] Screen-reader spam during streaming + double announcements**
      `src/components/Chat.tsx:166-168`
      `role="log"` + `aria-live="polite"` + `aria-relevant="additions text"` re-announces
      the growing answer on every streamed chunk; nested `role=alert`/`role=status` inside
      the live region announce twice.
      Fix: drop `"text"` from `aria-relevant`, hide streaming text from SR (`aria-hidden`),
      swap in final text once `done` arrives; move alert/status outside the log.

- [ ] **Retention silently stops if `CRON_SECRET` is missing/short**
      `src/lib/privacy/cron.ts:8`, `src/app/api/cron/privacy-cleanup/route.ts:10`
      Fail-closed auth becomes fail-open *retention*: every cron call 401s and worker data
      is kept forever with no alert.
      Fix: readiness/health check should fail if `CRON_SECRET` is absent in production.

- [ ] **Readiness endpoint reports green with no inference credentials**
      `src/app/api/health/ready/route.ts:14`
      `getEmbedder().generation` is computed without a live call, so a deploy missing
      `OPENAI_API_KEY`/`VOYAGE_API_KEY` returns 200 `ready` while every chat turn fails at
      runtime.
      Fix: add a `checks.inferenceConfigured` key-presence check (no live call needed).

---

## 🟡 Medium priority

- [x] **PII scrubber misses unstructured identifiers**
      `src/lib/safety/pii.ts:10-19`
      Names, employers, addresses, 6-digit SG postal codes survive into 30-day stored chat
      text (structured-only regex: email, NRIC/FIN, phone, digit runs). A DB compromise or
      legal demand re-identifies a worker via "My boss Mr Tan of Hin Leong Marine…".
      Fix: add name/address heuristics or an NER pass; regex for postal codes and
      space-tolerant NRIC/phone forms.

- [x] **CSRF origin check bypassed when `Origin` header is absent**
      `src/app/api/contract/route.ts:37-43`, `src/app/api/admin/logout/route.ts:5-8`
      `if (requestOrigin && requestOrigin !== origin) reject` passes when Origin is
      missing. The login route already fixed this exact gap with a Referer fallback —
      contract and logout weren't updated to match.
      Fix: reuse the login route's same-origin-or-referer helper everywhere.

- [x] **CSP allows `script-src 'unsafe-inline'`**
      `next.config.ts:31`
      Otherwise-tight CSP (object-src none, frame-ancestors none) is undercut by inline
      scripts being allowed — provides ~no XSS mitigation for script injection.
      Fix: nonce-based CSP via middleware (Next supports this natively).

- [x] **Rate limiting fails open to per-instance memory on Redis outage**
      `src/lib/ratelimit.ts:132-138`
      On Upstash error/timeout, falls back to in-memory buckets — across N serverless
      instances the effective ceiling becomes N×limit on the two OpenAI-billed routes
      (chat, contract). Admin login correctly 503s on memory fallback in prod; worker
      routes don't.
      Fix: alert on `source:"memory"` in production; consider failing closed on
      `/api/contract` specifically (vision calls are the costliest).

- [x] **Client disconnect cascades through chat stream's catch/finally**
      `src/app/api/chat/route.ts:270-299`
      No `req.signal`/cancel handling. Mobile disconnect mid-generation → terminal
      `controller.enqueue(done)` throws → catch's `enqueue(error)` throws → `finally
      controller.close()` throws. Result: `message_sent` metric silently skipped, spurious
      Sentry TypeError per disconnect, LLM call burns to completion anyway.
      Fix: guard terminal enqueues via the `cancel()` callback; pass an abort signal to
      the OpenAI call.

- [x] **Burmese/Thai text has no recognized break characters — mid-cluster hard splits**
      `src/lib/rag/chunk.ts:56,62`, `src/lib/rag/answer.ts:207`
      Split class omits Burmese `၊`/`။`; Thai has no terminators at all. Long paragraphs
      hard-split at `maxChars`, cutting grapheme clusters and surrogate pairs — garbles
      embedding/citation quotes. Also makes the "uncited trailing sentence" citation rule
      inert for Burmese answers.
      Fix: add `၊။ฯ` to both classes; use `Intl.Segmenter` grapheme boundaries in the
      hard-split fallback.

- [x] **Truncated/refused contract analysis becomes an opaque 500**
      `src/lib/contract/analyze.ts:191-196`
      `max_completion_tokens: 2048` + strict JSON schema: a dense multi-page contract in a
      token-heavy script (Burmese/Tamil) can hit `finish_reason: "length"` → truncated
      JSON → `JSON.parse` throws → 500 with only a generic client error. Same path for a
      safety refusal.
      Fix: check `finish_reason`/`refusal`; on truncation return a structured 422 ("photo
      too long — crop to one page") instead of a 500.

- [x] **No index on `referrals.conversation_id`**
      `src/lib/db/schema.ts:183-187`
      Queried on every escalated chat turn (`chat/route.ts:209-219`) plus retention/
      right-to-delete `IN (…)` deletes — all seq scans today, degrades linearly with
      referral volume.
      Fix: `CREATE INDEX referrals_conversation_idx ON referrals(conversation_id)`.

- [x] **`DATA_RETENTION_DAYS` clamps at 90, UI promises "up to 30 days"**
      `src/lib/privacy/retention.ts:11-20`
      `MAX_RETENTION_DAYS = 90` lets a single env var triple the promised retention window
      with no code or copy change.
      Fix: clamp to 30 (the promised ceiling), or derive the UI string from the same
      constant.

- [x] **[redesign] Contrast/focus-ring regressions from the new palette**
      `src/app/[locale]/emergency/page.tsx:110` (verifyNote, 2.58:1 — AA fail)
      `src/components/Chat.tsx:326,362,369`, `emergency/page.tsx:97`,
      `ContractUpload.tsx:123` (sky focus ring on white, 2.53:1 — fails 3:1 non-text
      minimum)
      Fix: swap `text-faint` → `text-muted` for body text; use `ring-navy` instead of
      `ring-sky` on white/light surfaces (keep sky ring only on navy backgrounds).

- [x] **[redesign] Dark mode dropped with no `color-scheme` declaration**
      `src/app/globals.css:49-55`
      Old globals.css had `prefers-color-scheme: dark` vars; redesign hardcodes white bg
      with no `color-scheme` anywhere. Chrome Android's "auto-darken websites" (common on
      cheap Androids) may force-invert the un-declared page, mangling the navy/sky
      palette unpredictably.
      Fix (minimum): add `:root { color-scheme: light }`.

- [x] **[redesign] Hardcoded English strings outside the 8-locale catalogs**
      `src/components/SiteHeader.tsx:82` (`aria-label="Primary"`)
      `src/app/[locale]/emergency/page.tsx:99` (`` `SMS ${c.number}` ``)
      `public/sw.js:79` (offline fallback — shown to non-English users specifically when
      offline and in distress)
      `src/app/global-error.tsx` (entirely English, `lang="en"`)
      Fix: catalog keys for the first two; embed a short multilingual string set for
      sw.js/global-error.tsx since both run outside next-intl.

---

## 🟢 Lower priority

- [x] Contract-results live region mounts with its content already inside — not announced
      to screen readers (`ContractUpload.tsx:155-161`). Render the region unconditionally,
      populate it after.
- [ ] Service worker precache is all-or-nothing (`cache.addAll` rejects wholesale on one
      failed fetch) and doesn't cover `/_next/static` assets, so offline `/emergency`
      renders unstyled (`public/sw.js:9-23`). Use `Promise.allSettled`; precache the page's
      asset manifest or inline critical CSS for `/emergency`.
- [ ] 1-year `maid_sid` cookie planted on first chat message with no consent moment,
      unlike the contract flow which only sets it on save opt-in
      (`src/app/api/chat/route.ts:307-310`).
- [x] Cookie loss (clearing cookies / switching browser) orphans saved contract-analysis
      rows — worker can't delete them until the retention cron purges (`src/lib/privacy/
      delete.ts:31-59`). Consider noting in copy that deletion covers "this device" only.
- [ ] Referral TOCTOU: two concurrent escalated turns in one conversation can both pass
      the "no active referral" check and insert, minting two valid codes
      (`src/app/api/chat/route.ts:205-233`). Fix: partial unique index + `ON CONFLICT DO
      NOTHING`, or `SELECT … FOR UPDATE`.
- [ ] Citation-gate rejection (e.g. one uncited trailing sentence) mints a real referral
      record + handoff code via `ungroundedAnswer`'s `out_of_scope` path
      (`src/lib/rag/answer.ts:100-108`). Consider not minting a handoff code for
      formatting-only refusals.
- [ ] 8+-digit scrub rule removes salary amounts before the model sees them (e.g. "12000000
      rupiah" → "[number removed] rupiah") — realistic for IDR/VND/MMK figures
      (`src/lib/safety/pii.ts:18`). Consider exempting the model-input path from this rule.
- [x] `src/lib/ratelimit.ts:9,45` — local in-memory rate-limit fallback keys embed the raw
      client IP (Redis path is correctly HMAC-hashed). Hash keys in the memory path too.
- [x] `src/lib/observability/sentry.ts:23-28` — Sentry message/breadcrumb scrubbing
      inherits the same PII regex gaps as the chat scrubber (see high-priority PII item).
- [x] `src/lib/db/schema.ts:200` — dead `feedback.comment` free-text column; no code path
      writes to it, but it invites a future unscrubbed-prose regression. Drop it.
- [x] `src/app/api/health/ready/route.ts:11-51` — publicly discloses `database: true/false`
      and index status to unauthenticated callers. Low value recon; consider gating or
      reducing to opaque 200/503.
- [ ] Non-Vercel deploys without `TRUST_PROXY_HEADERS=true` share a single `"anon"`
      rate-limit bucket for all clients (`src/lib/ratelimit.ts:142-156`) — documented
      safe default, just be aware.
- [ ] `src/app/api/contract/route.ts:37-43` — Origin check compares against
      `new URL(req.url).origin`; unconfirmed but could 403 same-origin requests if
      self-hosted behind a Host-rewriting proxy.
- [ ] No `pnpm audit` step or Dependabot/Renovate config in CI
      (`.github/workflows/ci.yml`).
- [x] `pnpm lint` exits 0 on warnings — `no-unused-vars` demoted to warn is never enforced
      (`eslint.config.mjs:20`). Add `--max-warnings 0` to the CI lint step.
- [x] Dead `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` in `.env.example` and DEPLOYMENT.md
      — referenced nowhere in code. Remove until wired.
- [ ] `tsconfig.json` has `strict: true` but not `noUncheckedIndexedAccess` — indexed
      access on short arrays (e.g. `referrals[0].org`) types as non-undefined, risking a
      runtime TypeError instead of a compile error.
- [ ] `public/sw.js:3` — manual `CACHE = "migraaid-v4"` version bump; a deploy that
      changes precached pages without touching `sw.js` leaves stale offline content.
      Inject the build id at build time.
- [x] `.github/workflows/ci.yml:41` — no Playwright browser cache and no `concurrency`
      cancellation group; superseded pushes keep running full e2e suites.
- [x] `[redesign]` `src/components/LocaleSwitcher.tsx:27` — transparent `<select>` has no
      explicit font-size (UA default triggers iOS Safari zoom-on-focus); `<option>`s lack
      `lang` attributes so screen readers mispronounce native-script names. Add
      `text-[16px]` and `lang={l}` per option (LanguagePicker.tsx already does the latter).
- [x] `[redesign]` `src/app/manifest.ts:13` — PWA `theme_color` (`#2563eb`) still the
      pre-redesign blue; clashes with the navy `#0c2b5e` header in installed-PWA chrome.
- [x] Untracked `design_handoff_migraaid_redesign/` not gitignored — stray `git add .`
      risk. Add to `.gitignore` or relocate.

---

## Top untested behaviors worth a test each

1. Chat client handling of the `{"type":"error"}` NDJSON frame / mid-stream disconnect —
   e2e that fulfills `/api/chat` with an error frame and asserts a localized, retryable
   message instead of a hung spinner.
2. `deleteExpiredWorkerData` cron logic (`src/lib/privacy/retention.ts:25`) — unit test
   asserting conversations with an active unconfirmed referral code survive the cutoff
   while expired contract reviews are purged.
3. Admin-login fail-closed 503 when the rate limiter degrades to memory in production
   (`requireDistributedLimiter`, `admin/login/route.ts:28`).
4. Chat conversation-ownership check + DB-outage resilience
   (`chat/route.ts:146` and `:262`) — replayed foreign `conversationId` gets a fresh
   conversation; a DB outage still yields a `done` frame.
5. Locale fallback merge `withFallback` (`src/i18n/request.ts:16`) — currently dead code
   since catalog-parity tests keep every locale fully translated; the first real partial
   translation would exercise this path untested.

---

## What's already solid (no action needed)

- Every UI privacy promise verified kept in code: contract photos never touch disk/DB/
  logs, verbatim clause quotes deliberately excluded from storage, consent is strict
  opt-in, no chat read-back endpoint exists at all.
- Fail-closed answer pipeline: deterministic injection preflight, grounding-score gate
  hardened against empty env vars, per-paragraph citation-coverage rejection, buffered
  streaming so unvalidated text never reaches the browser.
- Handoff codes: 60-bit CSPRNG, SHA-256 hashed at rest, TTL-bounded, single-use; admin
  referral surface can't reach conversation content.
- Analytics unlinkable by construction (fresh per-event IDs, no session id accepted);
  Sentry strips user/cookies/headers and scrubs transactions too (with a test).
- No SQL injection surface — all queries parameterized via Drizzle.
- CI gates typecheck/unit/lint/build/e2e/migration-drift on every PR; deploy scripts
  refuse transaction-pooler URLs; DEPLOYMENT.md matches the actual scripts line-for-line.
- All 8 message catalogs have zero missing keys and zero placeholder/rich-tag mismatches
  (verified programmatically) — a defensive English-fallback merge backs this up.
- Palette contrast is strong everywhere *except* the two flagged spots above (sky-on-navy
  5.44:1, hero lede 7.47:1, white-on-emergency 6.57:1, all AA).
