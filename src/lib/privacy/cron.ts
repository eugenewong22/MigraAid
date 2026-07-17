import { timingSafeEqual } from "node:crypto";

/**
 * True when a cron secret strong enough for the retention job is configured.
 * Without it the scheduled cleanup 401s and worker data is never purged, so the
 * readiness gate treats a missing/weak secret as not-ready in production.
 */
export function isCronSecretConfigured(
  secret = process.env.CRON_SECRET,
): boolean {
  return typeof secret === "string" && secret.length >= 32;
}

/** Constant-time bearer-token check shared by the scheduled cleanup route/tests. */
export function hasValidCronAuthorization(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || secret.length < 32 || !authorization?.startsWith("Bearer ")) {
    return false;
  }
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
