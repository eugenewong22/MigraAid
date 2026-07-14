# Contributing to MigraAid

MigraAid is open-source so partner NGOs and civic-tech volunteers can run, adapt, and improve it.
Contributions of all kinds are welcome — code, translations, content review, and testing.

## Getting started

```bash
pnpm install
cp .env.example .env.local     # see DEPLOYMENT.md for the values
pnpm dev
```

## Before you open a PR

Run the same checks CI runs:

```bash
pnpm typecheck && pnpm test && pnpm lint
```

## Especially valuable contributions

- **Content review** — verify the legal/procedural accuracy of items in `content/` and the
  hotline numbers in `src/lib/referral/emergency.ts`. See `content/README.md`.
- **Translation QA** — review the machine-drafted catalogs in `messages/` with a native speaker.
  See `TRANSLATIONS.md`.
- **Golden eval** — add NGO-verified question/answer pairs to `eval/golden.json` (per domain and
  language) so the accuracy gate stays strong as the corpus grows.

## Safety first

This tool serves vulnerable people. Changes that affect answer accuracy, escalation behaviour,
citations, or privacy (no worker PII, ephemeral contract images) get extra scrutiny — please call
out anything in those areas explicitly in your PR description.
