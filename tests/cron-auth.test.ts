import { describe, expect, it } from "vitest";
import {
  hasValidCronAuthorization,
  isCronSecretConfigured,
} from "@/lib/privacy/cron";

describe("privacy cleanup cron authorization", () => {
  const secret = "a-strong-cleanup-secret-with-32-characters";

  it("accepts only the exact bearer secret", () => {
    expect(hasValidCronAuthorization(`Bearer ${secret}`, secret)).toBe(true);
    expect(hasValidCronAuthorization("Bearer wrong", secret)).toBe(false);
    expect(hasValidCronAuthorization(null, secret)).toBe(false);
  });

  it("fails closed for missing or weak server configuration", () => {
    expect(hasValidCronAuthorization(`Bearer ${secret}`, undefined)).toBe(false);
    expect(hasValidCronAuthorization("Bearer short", "short")).toBe(false);
  });

  it("treats only a >=32-char secret as configured (retention gate)", () => {
    expect(isCronSecretConfigured(secret)).toBe(true);
    expect(isCronSecretConfigured("short")).toBe(false);
    expect(isCronSecretConfigured("")).toBe(false);
    expect(isCronSecretConfigured(undefined)).toBe(false);
  });
});
