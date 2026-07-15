import { describe, expect, it } from "vitest";
import { hasValidCronAuthorization } from "@/lib/privacy/cron";

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
});
