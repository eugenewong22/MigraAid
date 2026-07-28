# Security

MigraAid serves low-wage migrant workers asking about unpaid salary, workplace
injury and immigration status. A vulnerability here can expose people who are
already in a precarious position, so reports are taken seriously and answered.

## Reporting

Open a [private security advisory](https://github.com/eugenewong22/MigraAid/security/advisories/new)
on the repository. Please do not open a public issue for anything exploitable.

Expect an acknowledgement within a few days. This is a small independent
project run by one person, not a company with a security team — the response
will be honest about what can and cannot be fixed quickly.

## What is most worth reporting

In rough order of how much harm it would do:

1. **Cross-worker data exposure.** Every worker's data is scoped by an opaque
   session cookie. The runtime database role deliberately bypasses row-level
   security, so isolation rests on application-level predicates. A path that
   returns or deletes another session's conversations, contract analyses or
   referral codes is the most serious class of bug in this codebase.
2. **Anything that makes the assistant answer without citations**, or that
   bypasses the escalation routing for a high-stakes question. The citation
   gate in `src/lib/rag/answer.ts` is fail-closed by design; a way past it means
   a worker can be told something no source supports.
3. **Prompt injection through retrieved content or an uploaded contract** that
   changes what the assistant tells a worker.
4. **Admin authentication or authorisation flaws.** Publishing content and
   confirming referrals are behind Supabase auth with role checks in
   `src/lib/content/auth.ts`.
5. **Leaks of personal data into logs or error reports.** Sentry payloads are
   scrubbed in `src/lib/observability/sentry.ts`; a way to get raw text through
   is worth reporting.

## Out of scope

Missing security headers with no demonstrated impact, rate-limit tuning,
automated-scanner output without a working proof of concept, and issues in
third-party services (Vercel, Supabase, Upstash, OpenAI) — report those to them.

## Handling data you find

If a report requires demonstrating access to real worker data, please stop at
the minimum needed to show the issue, do not retain a copy, and say so in the
report. Do not access, modify or delete anything belonging to a real user.
