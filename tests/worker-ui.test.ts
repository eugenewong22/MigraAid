import { describe, expect, it } from "vitest";
import { progressPercent } from "@/components/Chat";
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

describe("contractUploadErrorForStatus — service unavailable", () => {
  it("does not tell a worker to retake the photo when the service stopped itself", () => {
    // 503 is a degraded limiter, a spend ceiling or a flag. The generic copy
    // says "please try a clearer photo", which is wrong and expensive: each
    // retry burns another of their five per minute for a problem no photo
    // can fix.
    expect(contractUploadErrorForStatus(503)).toBe("errorUnavailable");
  });

  it("still maps the statuses a photo can actually fix", () => {
    expect(contractUploadErrorForStatus(413)).toBe("errorTooLarge");
    expect(contractUploadErrorForStatus(415)).toBe("errorInvalidFile");
    expect(contractUploadErrorForStatus(429)).toBe("errorRateLimited");
    expect(contractUploadErrorForStatus(500)).toBe("error");
  });
});

describe("progressPercent", () => {
  it("moves forward through the stages", () => {
    expect(progressPercent("searching", 0)).toBeLessThan(progressPercent("reading", 0));
    expect(progressPercent("reading", 0)).toBeLessThan(progressPercent("writing", 100));
    expect(progressPercent("writing", 900)).toBeLessThan(progressPercent("checking", 0));
  });

  it("never claims to be finished while still writing", () => {
    // A bar that sits at 100% for twenty seconds reads as a hang.
    expect(progressPercent("writing", 100_000)).toBeLessThanOrEqual(90);
  });

  it("grows with how much has been written", () => {
    expect(progressPercent("writing", 600)).toBeGreaterThan(
      progressPercent("writing", 100),
    );
  });

  it("shows something for an unknown or absent stage", () => {
    expect(progressPercent(null, 0)).toBeGreaterThan(0);
    expect(progressPercent("something-new", 0)).toBeGreaterThan(0);
  });
});
