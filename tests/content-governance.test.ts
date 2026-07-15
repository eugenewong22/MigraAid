import { describe, expect, it } from "vitest";
import { isIndependentReviewer } from "@/lib/content/cms";

describe("content review separation of duties", () => {
  const submitted = {
    submittedBy: "author-user-id",
    lastEditedBy: "editor-user-id",
  };

  it("allows only a person who neither edited nor submitted the version", () => {
    expect(isIndependentReviewer(submitted, "reviewer-user-id")).toBe(true);
    expect(isIndependentReviewer(submitted, "author-user-id")).toBe(false);
    expect(isIndependentReviewer(submitted, "editor-user-id")).toBe(false);
  });

  it("does not treat an unsubmitted item as reviewable", () => {
    expect(
      isIndependentReviewer(
        { submittedBy: null, lastEditedBy: "editor-user-id" },
        "reviewer-user-id",
      ),
    ).toBe(false);
  });
});
