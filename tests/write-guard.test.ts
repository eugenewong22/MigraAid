import { describe, expect, it } from "vitest";
import {
  ALLOW_REMOTE_WRITE_ENV,
  checkWriteTarget,
  isLocalDatabase,
} from "@/lib/db/write-guard";

const LOCAL = "postgres://postgres:postgres@localhost:5432/migraaid";
const CI_SERVICE = "postgres://postgres:postgres@postgres:5432/migraaid_eval";
const REMOTE = "postgres://u:p@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres";

describe("isLocalDatabase", () => {
  it.each([LOCAL, CI_SERVICE, "postgres://x@127.0.0.1:5432/db", "postgres://x@db:5432/d"])(
    "accepts %s",
    (url) => {
      expect(isLocalDatabase(url)).toBe(true);
    },
  );

  it.each([REMOTE, "postgres://x@db.example.com:5432/d", "not-a-url"])(
    "rejects %s",
    (url) => {
      expect(isLocalDatabase(url)).toBe(false);
    },
  );
});

describe("checkWriteTarget", () => {
  it("allows a local database with no ceremony", () => {
    expect(checkWriteTarget(LOCAL, undefined)).toMatchObject({ allowed: true });
  });

  it("allows a CI service container", () => {
    expect(checkWriteTarget(CI_SERVICE, undefined)).toMatchObject({ allowed: true });
  });

  it("refuses a remote database by default", () => {
    const decision = checkWriteTarget(REMOTE, undefined);
    expect(decision.allowed).toBe(false);
    expect(decision.hostname).toBe("aws-1-ap-northeast-2.pooler.supabase.com");
    expect(decision.reason).toMatch(/refusing to write to the remote database/);
  });

  it("explains the override that made this guard necessary", () => {
    // The failure mode was a command-line DATABASE_URL silently replaced by
    // .env.local, so the message has to name that specifically.
    expect(checkWriteTarget(REMOTE, undefined).reason).toMatch(/\.env\.local/);
    expect(checkWriteTarget(REMOTE, undefined).reason).toContain(
      ALLOW_REMOTE_WRITE_ENV,
    );
  });

  it("allows a remote database only on an explicit, exact opt-in", () => {
    expect(checkWriteTarget(REMOTE, "1")).toMatchObject({ allowed: true });
    for (const value of ["true", "yes", "0", "", " 1"]) {
      expect(checkWriteTarget(REMOTE, value).allowed, `value=${value}`).toBe(false);
    }
  });

  it("refuses an unset or unparseable DATABASE_URL rather than guessing", () => {
    expect(checkWriteTarget(undefined, "1")).toMatchObject({
      allowed: false,
      hostname: "(unset)",
    });
    expect(checkWriteTarget("nonsense", "1")).toMatchObject({ allowed: false });
  });
});
