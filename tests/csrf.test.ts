import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as chat } from "@/app/api/chat/route";
import { POST as feedback } from "@/app/api/feedback/route";
import { DELETE as privacyDelete } from "@/app/api/privacy/route";

// The guards run before rate limiting, parsing, and any database access, so
// these tests need no infrastructure: a cross-origin request must be rejected
// outright on every state-changing worker route.
function request(
  url: string,
  method: string,
  origin: string | null,
): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (origin) headers.origin = origin;
  return new NextRequest(
    new Request(url, {
      method,
      headers,
      body: method === "DELETE" ? undefined : JSON.stringify({}),
      duplex: "half",
    } as RequestInit & { duplex: "half" }),
  );
}

describe("state-changing worker routes require a same-origin proof", () => {
  it("rejects a cross-origin chat message", async () => {
    const res = await chat(
      request("https://example.test/api/chat", "POST", "https://evil.test"),
    );
    expect(res.status).toBe(403);
  });

  it("rejects a chat message with no origin or referer at all", async () => {
    const res = await chat(
      request("https://example.test/api/chat", "POST", null),
    );
    expect(res.status).toBe(403);
  });

  it("rejects cross-origin feedback", async () => {
    const res = await feedback(
      request("https://example.test/api/feedback", "POST", "https://evil.test"),
    );
    expect(res.status).toBe(403);
  });

  it("rejects a cross-origin right-to-delete request", async () => {
    const res = await privacyDelete(
      request("https://example.test/api/privacy", "DELETE", "https://evil.test"),
    );
    expect(res.status).toBe(403);
  });
});
