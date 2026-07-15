# Knowledge base seed corpus

Markdown files here are ingested into the RAG index by `pnpm ingest`. Layout:

```
content/<domain>/<slug>.md
```

`<domain>` is one of: `legal_rights`, `healthcare`, `housing`, `financial`, `settlement`.

Each file has governance frontmatter. The ingester fails closed: a file is
stored as a draft and has all of its vectors removed unless every publication
field below is valid.

```markdown
---
title: Human-readable title
status: published
reviewed_by: Partner NGO reviewer or review team
reviewed_at: 2026-07-14
source_ref: Employment Act 1968, s. 21
source_url: https://sso.agc.gov.sg/Act/EmA1968
---
Body in plain language…
```

Publication requirements:

- `status` must explicitly be `published`. Use `draft` while work is in progress.
- `reviewed_by` must identify the person or accountable review team; placeholders
  such as `TBD` are rejected.
- `reviewed_at` must be a real, non-future calendar date in `YYYY-MM-DD` format.
- Provide a precise `source_ref`, a canonical HTTPS `source_url`, or both. A
  `source_url`, when present, must be an absolute HTTPS URL without embedded
  credentials.

Removing or invalidating any of this metadata on a later run downgrades the
repository-managed item to `draft` and deletes its existing chunks. Re-running
the ingester is idempotent.

> ⚠️ **These seed documents are illustrative.** Before real workers rely on them, every item must
> be reviewed and verified by a partner NGO (HOME / TWC2) and kept current via the admin CMS (M5).
> Do not add reviewer metadata until that review has actually happened.
> `source_ref` is what the assistant cites, so keep it precise.
