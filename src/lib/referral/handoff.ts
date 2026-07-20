import { randomBytes } from "node:crypto";
import { sensitiveRateLimitKey } from "@/lib/ratelimit";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_CHARACTERS = 12;
export const REFERRAL_CODE_TTL_DAYS = 30;

/** Generate a 60-bit, human-readable code without ambiguous 0/O/1/I glyphs. */
export function generateHandoffCode(): string {
  const bytes = randomBytes(CODE_CHARACTERS);
  const body = Array.from(bytes, (byte) => ALPHABET[byte & 31]).join("");
  return `MA-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
}

export function normalizeHandoffCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^MA[2-9A-HJ-NP-Z]{12}$/.test(compact)) return null;
  return `MA-${compact.slice(2, 6)}-${compact.slice(6, 10)}-${compact.slice(10)}`;
}

/**
 * A DB/backup leak of a bare `sha256(publicPrefix + code)` digest lets an
 * attacker brute-force the 60-bit code space offline — the old prefix is a
 * public constant in this open-source file, not a secret, so it added no
 * protection. Keying the digest on the same fleet-wide secret used for
 * rate-limit keys (`RATE_LIMIT_HASH_SALT`; see `sensitiveRateLimitKey` in
 * `@/lib/ratelimit`, which also HMAC-domain-separates by scope) means an
 * offline dictionary attack now also needs the deployment's secret, not just
 * the leaked table. No new env var is introduced. This intentionally
 * invalidates every already-stored handoff code hash — acceptable pre-launch.
 */
export function hashHandoffCode(input: string): string {
  const normalized = normalizeHandoffCode(input);
  if (!normalized) throw new Error("Invalid referral handoff code");
  return sensitiveRateLimitKey("handoff", normalized);
}

export function handoffCodeExpiry(now = new Date()): Date {
  return new Date(now.getTime() + REFERRAL_CODE_TTL_DAYS * 86_400_000);
}
