import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Exercise the success path without Supabase: the bug was that setting a cookie
// on the immutable Response.redirect() threw, so logout never cleared the
// session and every valid login bounced back as a failure.
vi.mock("@/lib/content/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/content/auth")>();
  return {
    ...actual,
    signInAdmin: vi.fn(async () => ({
      accessToken: "test-access-token",
      expiresIn: 3600,
      role: "reviewer",
    })),
  };
});

import { ADMIN_COOKIE } from "@/lib/content/auth";
import { POST as login } from "@/app/api/admin/login/route";
import { POST as logout } from "@/app/api/admin/logout/route";

function post(
  url: string,
  body?: BodyInit,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(
    new Request(url, {
      method: "POST",
      body,
      headers: { origin: "https://example.test", ...headers },
      duplex: "half",
    } as RequestInit & { duplex: "half" }),
  );
}

describe("admin session cookies survive the redirect", () => {
  it("sets the session cookie on a 303 login without throwing", async () => {
    const res = await login(
      post(
        "https://example.test/api/admin/login",
        new URLSearchParams({
          email: "reviewer@example.org",
          password: "correct-horse-battery-staple",
          locale: "en",
        }).toString(),
        { "content-type": "application/x-www-form-urlencoded" },
      ),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/en/admin");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${ADMIN_COOKIE}=test-access-token`);
    expect(cookie).toContain("HttpOnly");
  });

  it("clears the session cookie on a 303 logout without throwing", async () => {
    const res = await logout(post("https://example.test/api/admin/logout"));

    expect(res.status).toBe(303);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${ADMIN_COOKIE}=;`);
    expect(cookie).toContain("Max-Age=0");
  });

  it("rejects a cross-origin logout submission", async () => {
    const res = await logout(
      post("https://example.test/api/admin/logout", undefined, {
        origin: "https://evil.test",
      }),
    );
    expect(res.status).toBe(403);
  });
});
