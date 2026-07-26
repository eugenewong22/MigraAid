import { describe, expect, it } from "vitest";
import {
  contentChanged,
  planIngest,
  sameChunks,
  type ExistingItem,
  type IngestFile,
} from "@/lib/content/ingest-plan";
import type { ContentVerification } from "@/lib/content/verification";

const GENERATION = "voyage:voyage-3:1024";
const REVIEWED_AT = new Date("2026-07-14T00:00:00.000Z");

const FILE: IngestFile = {
  domain: "legal_rights",
  title: "When must my salary be paid?",
  bodyMd: "Your employer must pay your salary at least once a month.",
  sourceRef: "Employment Act 1968, s. 21",
  sourceUrl: "https://sso.agc.gov.sg/Act/EmA1968",
  sourceId: "sg-employment-act-1968",
  sourceRetrievedAt: "2026-07-26",
  contentHash: "hash-a",
  sourceKey: "content/legal_rights/salary-payment.md",
};

const PUBLISHABLE: ContentVerification = {
  status: "published",
  publishable: true,
  reasons: [],
  reviewedBy: "Partner NGO legal review team",
  reviewedAt: "2026-07-14",
  sourceRef: FILE.sourceRef,
  sourceUrl: FILE.sourceUrl ?? undefined,
};

const UNPUBLISHABLE: ContentVerification = {
  status: "draft",
  publishable: false,
  reasons: ['frontmatter status must explicitly be "published"'],
  sourceRef: FILE.sourceRef,
};

/** A stored row that exactly matches FILE as the ingester would have written it. */
function publishedRow(overrides: Partial<ExistingItem> = {}): ExistingItem {
  return {
    id: "item-1",
    domain: FILE.domain,
    title: FILE.title,
    bodyMd: FILE.bodyMd,
    sourceRef: FILE.sourceRef,
    sourceUrl: FILE.sourceUrl,
    sourceId: FILE.sourceId,
    sourceRetrievedAt: FILE.sourceRetrievedAt,
    contentHash: FILE.contentHash,
    sourceKey: FILE.sourceKey,
    status: "published",
    version: 3,
    lastEditedBy: "repository-source",
    submittedBy: "repository-ingest",
    submittedVersion: 3,
    reviewedBy: "Partner NGO legal review team",
    reviewedAt: REVIEWED_AT,
    ...overrides,
  };
}

function draftRow(overrides: Partial<ExistingItem> = {}): ExistingItem {
  return publishedRow({
    status: "draft",
    submittedBy: null,
    submittedVersion: null,
    reviewedBy: null,
    reviewedAt: null,
    ...overrides,
  });
}

const PUBLISHED_PROVENANCE = {
  reviewedBy: "Partner NGO legal review team",
  reviewedAt: REVIEWED_AT,
};
const DRAFT_PROVENANCE = { reviewedBy: null, reviewedAt: null };

const CHUNKS = [FILE.bodyMd];
const STORED = [{ chunkText: FILE.bodyMd, embeddingGeneration: GENERATION }];

function plan(input: {
  existing?: ExistingItem;
  verification?: ContentVerification;
  file?: Partial<IngestFile>;
  storedChunks?: Array<{ chunkText: string; embeddingGeneration: string }>;
  chunks?: string[];
}) {
  const verification = input.verification ?? PUBLISHABLE;
  return planIngest({
    existing: input.existing,
    verification,
    file: { ...FILE, ...input.file },
    storedChunks: input.storedChunks ?? [],
    chunks: input.chunks ?? CHUNKS,
    embeddingGeneration: GENERATION,
    provenance: verification.publishable
      ? PUBLISHED_PROVENANCE
      : DRAFT_PROVENANCE,
  });
}

describe("sameChunks", () => {
  it("matches regardless of stored order", () => {
    const stored = [
      { chunkText: "b", embeddingGeneration: GENERATION },
      { chunkText: "a", embeddingGeneration: GENERATION },
    ];
    expect(sameChunks(stored, ["a", "b"], GENERATION)).toBe(true);
  });

  it("rejects a different count, different text, or a foreign embedding space", () => {
    expect(sameChunks(STORED, ["a", "b"], GENERATION)).toBe(false);
    expect(sameChunks(STORED, ["different"], GENERATION)).toBe(false);
    expect(sameChunks(STORED, CHUNKS, "openai:text-embedding-3-small:1024")).toBe(
      false,
    );
  });
});

describe("contentChanged", () => {
  it("is true when there is no stored row", () => {
    expect(contentChanged(undefined, PUBLISHABLE, FILE, PUBLISHED_PROVENANCE)).toBe(
      true,
    );
  });

  it("is false when the stored row matches what the ingester would write", () => {
    expect(
      contentChanged(publishedRow(), PUBLISHABLE, FILE, PUBLISHED_PROVENANCE),
    ).toBe(false);
  });

  it.each([
    ["domain", { domain: "housing" }],
    ["title", { title: "Something else" }],
    ["bodyMd", { bodyMd: "Different prose" }],
    ["sourceRef", { sourceRef: "Other Act" }],
    ["sourceUrl", { sourceUrl: null }],
    ["sourceId", { sourceId: "mom-salary-payment" }],
    ["sourceRetrievedAt", { sourceRetrievedAt: "2025-01-01" }],
    ["contentHash", { contentHash: "hash-b" }],
    ["status", { status: "draft" as const }],
    ["lastEditedBy", { lastEditedBy: "someone@example.org" }],
    ["submittedBy", { submittedBy: null }],
    ["submittedVersion", { submittedVersion: 99 }],
    ["reviewedBy", { reviewedBy: "someone else" }],
    ["reviewedAt", { reviewedAt: new Date("2020-01-01T00:00:00.000Z") }],
  ])("detects drift in %s", (_field, overrides) => {
    expect(
      contentChanged(
        publishedRow(overrides),
        PUBLISHABLE,
        FILE,
        PUBLISHED_PROVENANCE,
      ),
    ).toBe(true);
  });

  it("ignores source_key, which is reconciled separately", () => {
    expect(
      contentChanged(
        publishedRow({ sourceKey: null }),
        PUBLISHABLE,
        FILE,
        PUBLISHED_PROVENANCE,
      ),
    ).toBe(false);
  });
});

describe("planIngest — unpublishable files", () => {
  it("drafts a file the database has never seen", () => {
    expect(plan({ verification: UNPUBLISHABLE })).toEqual({
      kind: "hold-draft",
      write: true,
      version: 1,
      reasons: UNPUBLISHABLE.reasons,
    });
  });

  it("skips the write when the stored draft is already current and de-indexed", () => {
    expect(
      plan({ verification: UNPUBLISHABLE, existing: draftRow() }),
    ).toMatchObject({ kind: "hold-draft", write: false, version: 3 });
  });

  it("rewrites when the stored draft still has vectors", () => {
    expect(
      plan({
        verification: UNPUBLISHABLE,
        existing: draftRow(),
        storedChunks: STORED,
      }),
    ).toMatchObject({ kind: "hold-draft", write: true });
  });

  it("rewrites when the stored draft was adopted under a different source key", () => {
    expect(
      plan({ verification: UNPUBLISHABLE, existing: draftRow({ sourceKey: null }) }),
    ).toMatchObject({ kind: "hold-draft", write: true });
  });

  it("downgrades a published row and bumps its version", () => {
    expect(
      plan({
        verification: UNPUBLISHABLE,
        existing: publishedRow(),
        storedChunks: STORED,
      }),
    ).toMatchObject({ kind: "hold-draft", write: true, version: 4 });
  });
});

describe("planIngest — publishable files", () => {
  it("publishes and indexes a file the database has never seen", () => {
    expect(plan({})).toEqual({
      kind: "publish",
      version: 1,
      reindex: true,
      changed: true,
    });
  });

  it("skips a row whose metadata and vectors both already match", () => {
    expect(
      plan({ existing: publishedRow(), storedChunks: STORED }),
    ).toEqual({ kind: "skip-unchanged" });
  });

  it("re-embeds when the body changed", () => {
    expect(
      plan({
        existing: publishedRow(),
        storedChunks: STORED,
        file: { bodyMd: "Rewritten guidance", contentHash: "hash-b" },
        chunks: ["Rewritten guidance"],
      }),
    ).toEqual({ kind: "publish", version: 4, reindex: true, changed: true });
  });

  it("re-embeds when the stored vectors are from another embedding space", () => {
    expect(
      plan({
        existing: publishedRow(),
        storedChunks: [
          { chunkText: FILE.bodyMd, embeddingGeneration: "legacy" },
        ],
      }),
    ).toEqual({ kind: "publish", version: 3, reindex: true, changed: false });
  });

  it("updates metadata without re-embedding when only the title drifted", () => {
    expect(
      plan({
        existing: publishedRow({ title: "Stale title" }),
        storedChunks: STORED,
      }),
    ).toEqual({ kind: "publish", version: 4, reindex: false, changed: true });
  });

  it("adopts a legacy row without bumping its version or re-embedding", () => {
    expect(
      plan({
        existing: publishedRow({ sourceKey: null }),
        storedChunks: STORED,
      }),
    ).toEqual({ kind: "publish", version: 3, reindex: false, changed: false });
  });
});

describe("planIngest — items archived in the CMS", () => {
  it("leaves an archived item alone when the file has not changed", () => {
    expect(
      plan({ existing: publishedRow({ status: "archived" }) }),
    ).toEqual({ kind: "skip-archived" });
  });

  it("leaves it alone even when the file is not publishable", () => {
    expect(
      plan({
        verification: UNPUBLISHABLE,
        existing: publishedRow({ status: "archived" }),
      }),
    ).toEqual({ kind: "skip-archived" });
  });

  it("republishes once the file is edited — the 'you fixed it' path", () => {
    expect(
      plan({
        existing: publishedRow({ status: "archived" }),
        file: { bodyMd: "Corrected guidance", contentHash: "hash-b" },
        chunks: ["Corrected guidance"],
      }),
    ).toMatchObject({ kind: "publish", reindex: true });
  });

  it("re-drafts an edited file that is no longer publishable", () => {
    expect(
      plan({
        verification: UNPUBLISHABLE,
        existing: publishedRow({ status: "archived" }),
        file: { contentHash: "hash-b" },
      }),
    ).toMatchObject({ kind: "hold-draft", write: true });
  });
});
