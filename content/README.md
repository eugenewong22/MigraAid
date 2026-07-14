# Knowledge base seed corpus

Markdown files here are ingested into the RAG index by `pnpm ingest`. Layout:

```
content/<domain>/<slug>.md
```

`<domain>` is one of: `legal_rights`, `healthcare`, `housing`, `financial`, `settlement`.

Each file has simple frontmatter:

```markdown
---
title: Human-readable title
source_ref: Citation target, e.g. "Employment Act — salary payment"
---
Body in plain language…
```

> ⚠️ **These seed documents are illustrative.** Before real workers rely on them, every item must
> be reviewed and verified by a partner NGO (HOME / TWC2) and kept current via the admin CMS (M5).
> `source_ref` is what the assistant cites, so keep it precise.
