import { describe, expect, it } from "vitest";
import {
  CONTRACT_UPLOAD_MAX_BYTES,
  contractUploadErrorForStatus,
  validateContractUpload,
} from "@/lib/contract/upload";
import { sourceReferenceHref } from "@/lib/rag/source-link";

describe("worker citation links", () => {
  it("links only complete, credential-free HTTP(S) source references", () => {
    expect(sourceReferenceHref("https://www.mom.gov.sg/employment-practices")).toBe(
      "https://www.mom.gov.sg/employment-practices",
    );
    expect(sourceReferenceHref("http://example.org/source")).toBe(
      "http://example.org/source",
    );
    expect(sourceReferenceHref("MOM — salary payment")).toBeNull();
    expect(sourceReferenceHref("/relative-source")).toBeNull();
    expect(sourceReferenceHref("javascript:alert(1)")).toBeNull();
    expect(sourceReferenceHref("https://user:secret@example.org/source")).toBeNull();
  });
});

describe("contract upload preflight", () => {
  it("rejects unsupported and oversized files before upload", () => {
    expect(validateContractUpload({ type: "application/pdf", size: 100 })).toBe(
      "errorInvalidFile",
    );
    expect(
      validateContractUpload({
        type: "image/jpeg",
        size: CONTRACT_UPLOAD_MAX_BYTES + 1,
      }),
    ).toBe("errorTooLarge");
    expect(
      validateContractUpload({
        type: "image/png",
        size: CONTRACT_UPLOAD_MAX_BYTES,
      }),
    ).toBeNull();
  });

  it("maps known API failures to actionable worker messages", () => {
    expect(contractUploadErrorForStatus(400)).toBe("errorInvalidFile");
    expect(contractUploadErrorForStatus(413)).toBe("errorTooLarge");
    expect(contractUploadErrorForStatus(429)).toBe("errorRateLimited");
    expect(contractUploadErrorForStatus(500)).toBe("error");
  });
});
