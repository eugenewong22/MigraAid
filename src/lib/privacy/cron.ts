import { timingSafeEqual } from "node:crypto";

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
