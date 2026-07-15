import { describe, expect, it } from "vitest";
import { sanitizeSentryEvent } from "@/lib/observability/sentry";

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
      exception: { values: [{ value: "Call +65 9123 4567" }] },
    });
    expect(event.user).toBeUndefined();
    expect(event.request?.headers).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(event.exception?.values?.[0].value).not.toContain("9123");
  });
});
