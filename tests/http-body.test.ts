import { describe, expect, it } from "vitest";
import {
  readBoundedJson,
  readBoundedBytes,
  readBoundedUrlEncoded,
  RequestBodyTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/http/body";

describe("readBoundedJson", () => {
  it("parses a JSON request within the byte limit", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
    });
    await expect(readBoundedJson(request, 100)).resolves.toEqual({
      message: "hello",
    });
  });

  it("rejects a declared oversized request before reading it", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-length": "1000" },
      body: "{}",
    });
    await expect(readBoundedJson(request, 100)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });

  it("rejects an oversized body when Content-Length is absent", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ message: "x".repeat(200) }),
    });
    await expect(readBoundedJson(request, 100)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });
});

describe("readBoundedBytes", () => {
  it("preserves binary bytes while enforcing the streamed limit", async () => {
    const input = new Uint8Array([0, 255, 17, 42]);
    const request = new Request("https://example.test", {
      method: "POST",
      body: input,
    });
    await expect(readBoundedBytes(request, 4)).resolves.toEqual(input);
  });

  it("rejects malformed Content-Length values", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-length": "-1" },
      body: new Uint8Array([1]),
    });
    await expect(readBoundedBytes(request, 4)).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });
});

describe("readBoundedUrlEncoded", () => {
  it("parses a form when Content-Length is omitted", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: "email=Reviewer%40Example.org&password=secret",
    });
    expect(request.headers.get("content-length")).toBeNull();

    const form = await readBoundedUrlEncoded(request, 100);
    expect(form.get("email")).toBe("Reviewer@Example.org");
    expect(form.get("password")).toBe("secret");
  });

  it("rejects an oversized chunked form without Content-Length", async () => {
    const encoder = new TextEncoder();
    const chunks = ["email=user%40example.org&", `password=${"x".repeat(100)}`];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(request.headers.get("content-length")).toBeNull();

    await expect(readBoundedUrlEncoded(request, 64)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });

  it.each([undefined, "text/plain", "multipart/form-data; boundary=test"])(
    "rejects unsupported Content-Type %s",
    async (contentType) => {
      const headers = new Headers();
      if (contentType) headers.set("content-type", contentType);
      const request = new Request("https://example.test", {
        method: "POST",
        headers,
        body: "email=user%40example.org",
      });
      await expect(readBoundedUrlEncoded(request, 100)).rejects.toBeInstanceOf(
        UnsupportedMediaTypeError,
      );
    },
  );
});
