import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Force every sign-in attempt to fail with a genuine credential error (not a
// 503 "not configured") so the global per-account failure monitor (fix 7)
// gets exercised without a real Supabase backend.
vi.mock("@/lib/content/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/content/auth")>();
  return {
    ...actual,
    signInAdmin: vi.fn(async () => {
      throw new actual.AdminAuthError("Invalid email or password.", 401);
    }),
  };
});

const { reportErrorMock } = vi.hoisted(() => ({
  reportErrorMock: vi.fn(async (_error: unknown, _area: string) => {}),
}));
vi.mock("@/lib/observability/sentry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/observability/sentry")>();
  return { ...actual, reportError: reportErrorMock };
});

import { POST } from "@/app/api/admin/login/route";

function request(
  body: BodyInit,
  headers: Record<string, string>,
): NextRequest {
  const nativeRequest = new Request("https://example.test/api/admin/login", {
    method: "POST",
    body,
    headers: {
      origin: "https://example.test",
      "x-vercel-forwarded-for": `192.0.2.${Math.floor(Math.random() * 200) + 1}`,
      ...headers,
    },
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return new NextRequest(nativeRequest);
}

describe("admin login request boundary", () => {
  it.each([undefined, "application/json"])(
    "rejects a missing or unsupported form Content-Type",
    async (contentType) => {
      const response = await POST(
        request(
          '{"email":"reviewer@example.org"}',
          contentType ? { "content-type": contentType } : {},
        ),
      );
      expect(response.status).toBe(415);
    },
  );

  it("rejects an oversized chunked form when Content-Length is omitted", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("email=reviewer%40example.org&password="));
        controller.enqueue(encoder.encode("x".repeat(17 * 1024)));
        controller.close();
      },
    });
    const req = request(body, {
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(req.headers.get("content-length")).toBeNull();

    const response = await POST(req);
    expect(response.status).toBe(413);
  });
});

describe("admin login global per-account failure monitor", () => {
  it("fires a detection-only alert once a single account's failures cross the threshold across many IPs, without blocking sign-in", async () => {
    // A distinct, trusted per-request IP (rather than this file's default
    // shared "anon" bucket) so 51 attempts don't trip the per-IP/(email,IP)
    // blocking caps before reaching the monitor's own threshold — simulating
    // distributed credential stuffing from many sources against one account.
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    try {
      const email = `stuffing-target-${Math.random()}@example.org`;
      const body = new URLSearchParams({
        email,
        password: "wrong-password",
        locale: "en",
      }).toString();

      let lastResponse: Response | undefined;
      for (let i = 0; i < 51; i += 1) {
        lastResponse = await POST(
          request(body, {
            "content-type": "application/x-www-form-urlencoded",
            "x-forwarded-for": `10.0.0.${i}`,
          }),
        );
      }

      // Never a blocker: every attempt still gets the normal
      // redirect-with-error response, not a 429/503 from the monitor itself.
      expect(lastResponse?.status).toBe(303);
      const location = new URL(lastResponse!.headers.get("location") ?? "");
      expect(location.searchParams.get("error")).toBe("invalid_credentials");

      // The monitor call is fire-and-forget (`void`) — let its pending
      // microtasks (rateLimit + the mocked reportError) settle before
      // asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const spikeCalls = reportErrorMock.mock.calls.filter(
        ([, area]) => area === "api.admin-login.account-failure-spike",
      );
      expect(spikeCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
