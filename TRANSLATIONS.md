# Translations

MigraAid's UI is localized via `messages/<locale>.json` (next-intl). Eight locales:
`en`, `bn` (Bengali), `ta` (Tamil), `tl` (Tagalog), `zh` (Mandarin), `id` (Bahasa
Indonesia), `th` (Thai), `my` (Burmese).

## Status

- `en` — source of truth.
- All other locales — **draft machine translations. Each must be reviewed by a native
  speaker before launch**, the same verification gate applied to the legal corpus and
  emergency numbers.

Chatbot *answers* are generated in the user's language at runtime by the model (grounded
in the English source corpus), so answer quality tracks the model — these catalogs cover
only fixed UI text.

## Adding or updating a language

1. Copy `messages/en.json` to `messages/<locale>.json` and translate the values (keep the
   `MigraAid` brand and the phone digits `999`/`995` unchanged).
2. Add the locale to `src/i18n/routing.ts` and a native-script label in
   `src/components/LocaleSwitcher.tsx`.
3. Verify key parity — every locale must have exactly the same keys as `en`:

   ```bash
   node -e "const fs=require('fs');const en=JSON.parse(fs.readFileSync('messages/en.json','utf8'));const sig=o=>JSON.stringify(Object.keys(o).sort().map(s=>s+':'+Object.keys(o[s]).sort().join(',')));for(const f of fs.readdirSync('messages')){const j=JSON.parse(fs.readFileSync('messages/'+f,'utf8'));console.log((sig(j)===sig(en)?'OK  ':'FAIL')+f)}"
   ```
