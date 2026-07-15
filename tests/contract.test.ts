import { describe, it, expect } from "vitest";
import {
  detectImageType,
  hasMatchingImageSignature,
  isSupportedImageType,
  SUPPORTED_IMAGE_TYPES,
} from "@/lib/contract/analyze";
import { hasExplicitStorageConsent } from "@/lib/contract/privacy";

describe("isSupportedImageType", () => {
  it("accepts common phone photo formats", () => {
    for (const type of SUPPORTED_IMAGE_TYPES) {
      expect(isSupportedImageType(type)).toBe(true);
    }
  });

  it("rejects non-image and unsupported types", () => {
    expect(isSupportedImageType("application/pdf")).toBe(false);
    expect(isSupportedImageType("image/tiff")).toBe(false);
    expect(isSupportedImageType("")).toBe(false);
  });
});

describe("image signature validation", () => {
  const fixtures = [
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0]],
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/gif", [...Buffer.from("GIF89a")]],
    ["image/webp", [...Buffer.from("RIFF1234WEBP")]],
  ] as const;

  it.each(fixtures)("detects %s from its binary signature", (type, fixture) => {
    expect(detectImageType(Uint8Array.from(fixture))).toBe(type);
  });

  it("rejects spoofed and mismatched image payloads", () => {
    const html = new TextEncoder().encode("<html>not an image</html>");
    expect(detectImageType(html)).toBeNull();
    expect(hasMatchingImageSignature(html, "image/jpeg")).toBe(false);

    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(hasMatchingImageSignature(png, "image/jpeg")).toBe(false);
  });
});

describe("contract analysis storage consent", () => {
  it("accepts only the exact explicit opt-in value", () => {
    expect(hasExplicitStorageConsent("true")).toBe(true);
    expect(hasExplicitStorageConsent("on")).toBe(false);
    expect(hasExplicitStorageConsent("TRUE")).toBe(false);
    expect(hasExplicitStorageConsent(true)).toBe(false);
    expect(hasExplicitStorageConsent(null)).toBe(false);
  });
});
