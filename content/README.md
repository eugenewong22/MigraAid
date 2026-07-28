# The MigraAid knowledge base

Everything the assistant can say to a worker comes from this directory. If it is
not here, the assistant refuses and refers the worker to an organisation — which
is the correct outcome for a topic we have no verified source for. **A coverage
gap is always better than an unsourced claim.**

```
content/
  sources.json          the public documents we derive from
  _snapshots/<id>/      what each document said on the day we read it
  <domain>/<slug>.md    one knowledge item
```

`<domain>` is one of `legal_rights`, `healthcare`, `housing`, `financial`,
`settlement`.

## An item

```markdown
---
title: When must my salary be paid?
status: published
source_id: mom-paying-salary
source_ref: MOM — Paying salary
source_url: https://www.mom.gov.sg/employment-practices/salary/paying-salary
source_retrieved_at: 2026-07-26
---
If you are covered by the Employment Act, your employer must pay your salary at
least once a month, within 7 days after the salary period ends…

<!-- source-excerpt -->

> If you are covered by the Employment Act, your employer must pay your salary
> at least once a month.
```

Two parts, and the split matters:

- **The guidance** (above the delimiter) is what gets chunked, embedded, and
  answered from. Plain language, one topic, under ~1,100 characters so it stays
  a single retrieval chunk.
- **The anchor** (below the delimiter) is a verbatim passage of the source. It is
  **never embedded and never retrievable** — it exists so a reader can check the
  guidance against the thing it claims to restate, and so tests can prove every
  number in the guidance is real.

## Publishing

`status: published` plus a source reference is all it takes. `pnpm ingest` then
chunks, embeds, and indexes the item.

There is no reviewer field to fill in. Accountability comes from **git**: the
ingester records the commit that last touched the file as the item's
`reviewed_by`, so every published vector traces back to an author and a date. If
an item *did* get an expert review, record it with `reviewed_by` + `reviewed_at`
and that is used instead — but it is evidence, not a requirement.

Use `status: draft` while working. A draft is stored but never indexed, so it
cannot reach a worker.

### The repository wins

`pnpm ingest` overwrites the body of any repository-managed item, so **editing
one in the admin CMS is temporary** — the next ingest restores the file's
version. Edit the file.

The one exception is archiving: an item archived in the CMS stays archived and
de-indexed. Editing its file republishes it.

## Adding a source

1. Add an entry to `content/sources.json`: canonical URL, issuing authority,
   which domains it covers, and the licence it declares.
2. Read the host's `robots.txt` and terms of use. Record the date in
   `robotsCheckedAt` and what you found in `robotsNote`. Only then may
   `fetchPolicy` be `automated`. Record any `Crawl-delay` in `crawlDelaySeconds`.
3. `pnpm sources:fetch <id>` writes a snapshot and records its digest.

If a host refuses our identified user-agent, leave it `manual` and save the
snapshot by hand. **Never disguise the client to get around a refusal** — the
Singapore Statutes Online entries are `manual` for exactly this reason.

### Verbatim excerpts and licences

An anchor always lives in the repository. Storing it *in the database* — which
reproduces source text inside a running product — additionally requires:

1. a human to read that source's licence terms and record the outcome in
   `licence.verifiedBy` / `licence.verifiedAt`; and
2. that licence's id to be added to `VERBATIM_EXCERPT_ALLOWLIST` in
   `src/lib/content/licence.ts`, which is a code change and therefore reviewed.

A registry entry can *claim* a licence but can never *authorise itself*. Until
both happen, `pnpm ingest` keeps the anchor out of the database and says so.
The allowlist currently ships empty.

## Writing an item

`pnpm content:draft [source-id]` drafts from a snapshot. The division of labour
is the safety property:

- **the model** picks which passage of the source answers a worker's question and
  restates it in plain language;
- **the script** discards anything whose anchor is not a verbatim passage of the
  snapshot, whose guidance asserts a number the anchor does not contain, or which
  reads as advice;
- **you** read the result against its anchor and fix it before committing.

So the model can only point at a rule that is already in the source, and the
pointing is checked mechanically. What that cannot catch is **overgeneralisation**
— stating a right without the condition it depends on. That is the error to look
for, and it is why a person still edits every item.

### Checklist before you commit

- Does the first sentence state the condition the right depends on? Most
  Employment Act rights apply only to covered employees.
- Does every number appear in the anchor?
- Is the anchor really in the snapshot, and does it actually support the claim?
- Is it one topic, in language a non-native English reader can follow?
- Does it inform and refer, rather than advise?

## Commands

| Command | Does |
|---|---|
| `pnpm sources:fetch [id]` | Snapshot automated sources, record digests |
| `pnpm sources:check` | Re-fetch and report sources that changed |
| `pnpm content:draft [id]` | Draft items from a snapshot |
| `pnpm ingest` | Chunk, embed and index published items |
| `pnpm eval:offline` | Retrieval accuracy (recall@1/3/6, MRR), no model calls |
| `pnpm eval` | Full retrieve→answer against `eval/golden.json` |
| `pnpm test` | Corpus, fidelity and governance tests |

## When a source changes

Legislation and guidance get amended. A monthly job re-fetches every automated
source and opens an issue when a digest no longer matches, listing the items
derived from it. Re-read the source, `pnpm sources:fetch <id>`, then re-verify
each affected item against the new text.

## What is deliberately not here

**NGO material.** HOME, TWC2, MWC and HealthServe are referral targets, not
content sources — see `src/lib/referral/`. `home.org.sg` asks AI crawlers not to
ingest its content, and none of the four publishes a reuse licence. The
substantive rules come from legislation and MOM anyway.

**Translations.** The corpus is English. Non-English questions are translated to
English for retrieval and answered in the worker's language at generation time.
Translating legal text into eight languages ourselves would produce fluent,
confident, unverifiable claims.
