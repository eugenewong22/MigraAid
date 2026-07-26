/**
 * Refuse to run a corpus-writing script against a remote database by accident.
 *
 * `scripts/env.ts` loads `.env.local` with `override: true`, so a `DATABASE_URL`
 * set on the command line is silently replaced by whatever `.env.local` holds.
 * That makes `DATABASE_URL=... pnpm ingest` look like it targets a scratch
 * database while actually writing to production — which is exactly how this
 * guard came to exist.
 *
 * So the destination is checked rather than assumed: anything that is not
 * obviously a local database requires the operator to say so explicitly.
 */

const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  // Docker Compose / CI service-container names.
  "postgres",
  "db",
  "host.docker.internal",
]);

export const ALLOW_REMOTE_WRITE_ENV = "MIGRAAID_ALLOW_REMOTE_WRITE";

export function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export interface WriteGuardDecision {
  allowed: boolean;
  hostname: string;
  reason?: string;
}

export function checkWriteTarget(
  databaseUrl: string | undefined,
  allowRemote: string | undefined,
): WriteGuardDecision {
  if (!databaseUrl) {
    return { allowed: false, hostname: "(unset)", reason: "DATABASE_URL is not set" };
  }

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    return { allowed: false, hostname: "(unparseable)", reason: "DATABASE_URL is not a valid URL" };
  }

  if (isLocalDatabase(databaseUrl)) return { allowed: true, hostname };
  if (allowRemote === "1") return { allowed: true, hostname };

  return {
    allowed: false,
    hostname,
    reason:
      `refusing to write to the remote database at ${hostname}. ` +
      `If that is deliberate, set ${ALLOW_REMOTE_WRITE_ENV}=1. ` +
      `Note that scripts/env.ts loads .env.local with override:true, so a ` +
      `DATABASE_URL set on the command line does NOT take effect — edit ` +
      `.env.local, or export ${ALLOW_REMOTE_WRITE_ENV}=1 knowingly.`,
  };
}

/** Exit rather than write, unless the destination is local or explicitly allowed. */
export function assertWritableDatabase(scriptName: string): void {
  const decision = checkWriteTarget(
    process.env.DATABASE_URL,
    process.env[ALLOW_REMOTE_WRITE_ENV],
  );
  if (decision.allowed) {
    if (!isLocalDatabase(process.env.DATABASE_URL ?? "")) {
      console.warn(
        `${scriptName}: writing to REMOTE database ${decision.hostname} (${ALLOW_REMOTE_WRITE_ENV}=1)`,
      );
    }
    return;
  }
  console.error(`${scriptName}: ${decision.reason}`);
  process.exit(1);
}
