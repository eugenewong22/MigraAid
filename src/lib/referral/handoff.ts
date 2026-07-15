import { createHash, randomBytes } from "node:crypto";

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

export function hashHandoffCode(input: string): string {
  const normalized = normalizeHandoffCode(input);
  if (!normalized) throw new Error("Invalid referral handoff code");
  return createHash("sha256")
    .update(`migraaid-referral-v1:${normalized}`)
    .digest("hex");
}

export function handoffCodeExpiry(now = new Date()): Date {
  return new Date(now.getTime() + REFERRAL_CODE_TTL_DAYS * 86_400_000);
}
