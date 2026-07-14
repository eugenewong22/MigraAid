import { describe, it, expect } from "vitest";
import {
  isSupportedImageType,
  SUPPORTED_IMAGE_TYPES,
} from "@/lib/contract/analyze";

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
