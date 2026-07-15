import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
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
