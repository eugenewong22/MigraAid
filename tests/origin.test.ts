import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "@/lib/http/origin";

describe("isSameOriginRequest", () => {
  const request = (headers: HeadersInit) =>
    new Request("https://migraaid.example/api/action", { method: "POST", headers });

  it("accepts a matching Origin or Referer fallback", () => {
    expect(isSameOriginRequest(request({ origin: "https://migraaid.example" }))).toBe(true);
    expect(
      isSameOriginRequest(
        request({ referer: "https://migraaid.example/en/contract" }),
      ),
    ).toBe(true);
  });

  it("rejects missing, malformed, and cross-origin provenance", () => {
    expect(isSameOriginRequest(request({}))).toBe(false);
    expect(isSameOriginRequest(request({ referer: "not a url" }))).toBe(false);
    expect(isSameOriginRequest(request({ origin: "https://attacker.example" }))).toBe(false);
  });
});
