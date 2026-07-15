import { describe, expect, it } from "vitest";
import {
  adminPrincipalFromUser,
  isInsecureDevAdminBypassEnabled,
} from "@/lib/content/auth";

describe("adminPrincipalFromUser", () => {
  it("accepts roles only from trusted app metadata", () => {
    expect(
      adminPrincipalFromUser({
        id: "user-1",
        email: "reviewer@example.org",
        app_metadata: { role: "reviewer" },
      }),
    ).toEqual({ id: "user-1", email: "reviewer@example.org", role: "reviewer" });
  });

  it("rejects missing and unknown roles", () => {
    expect(adminPrincipalFromUser({ id: "user-1", app_metadata: {} })).toBeNull();
    expect(
      adminPrincipalFromUser({ id: "user-1", app_metadata: { role: "owner" } }),
    ).toBeNull();
  });
});

describe("isInsecureDevAdminBypassEnabled", () => {
  it("requires an explicit true value outside production", () => {
    expect(
      isInsecureDevAdminBypassEnabled({
        NODE_ENV: "development",
        ALLOW_INSECURE_DEV_ADMIN: "true",
      }),
    ).toBe(true);
    expect(
      isInsecureDevAdminBypassEnabled({
        NODE_ENV: "development",
        ALLOW_INSECURE_DEV_ADMIN: undefined,
      }),
    ).toBe(false);
  });

  it("always refuses the bypass in production", () => {
    expect(
      isInsecureDevAdminBypassEnabled({
        NODE_ENV: "production",
        ALLOW_INSECURE_DEV_ADMIN: "true",
      }),
    ).toBe(false);
  });
});
