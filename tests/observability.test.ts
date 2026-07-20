import { describe, expect, it } from "vitest";
import {
  sanitizeSentryEvent,
  sanitizeSentryTransaction,
} from "@/lib/observability/sentry";

describe("sanitizeSentryEvent", () => {
  it("removes request/user data and redacts exception PII", () => {
    const event = sanitizeSentryEvent({
      type: undefined,
      user: { email: "worker@example.org" },
      request: {
        cookies: { sid: "secret" },
        headers: { authorization: "Bearer secret" },
        data: "raw input",
        query_string: "name=worker",
      },
      exception: {
        values: [
          { value: "Call +65 9123 4567. My boss Mr Tan of Example Marine." },
        ],
      },
    });
    expect(event.user).toBeUndefined();
    expect(event.request?.headers).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(event.exception?.values?.[0].value).not.toContain("9123");
    expect(event.exception?.values?.[0].value).not.toContain("Tan");
    expect(event.exception?.values?.[0].value).not.toContain("Example Marine");
  });
});

describe("sanitizeSentryTransaction", () => {
  it("strips span/trace descriptions and data that carry outbound URLs or SQL", () => {
    const event = sanitizeSentryTransaction({
      type: "transaction",
      request: { query_string: "name=worker" },
      spans: [
        {
          description: "GET https://api.example.test/v1/secret?token=abc",
          data: { "http.url": "https://api.example.test/v1/secret?token=abc" },
        },
        {
          description: 'SELECT * FROM messages WHERE text = $1',
          data: { "db.statement": "SELECT * FROM messages WHERE text = $1" },
        },
      ],
      contexts: {
        trace: {
          description: "GET https://api.example.test/v1/secret?token=abc",
          data: { url: "https://api.example.test/v1/secret" },
        },
      },
    } as never) as {
      request?: { query_string?: string };
      spans?: { description?: unknown; data?: unknown }[];
      contexts?: { trace?: { description?: unknown; data?: unknown } };
    };

    expect(event.request?.query_string).toBeUndefined();
    for (const span of event.spans ?? []) {
      expect(span.description).toBeUndefined();
      expect(span.data).toBeUndefined();
    }
    expect(event.contexts?.trace?.description).toBeUndefined();
    expect(event.contexts?.trace?.data).toBeUndefined();
  });
});
