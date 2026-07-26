/**
 * The seed ingester's governance decision, as a pure function.
 *
 * `scripts/ingest/run.ts` owns the database work; this module owns the choice of
 * *what* to do with a repository file. Keeping the decision here makes it
 * testable without a database and keeps the driver small enough to audit.
 */
import type { ContentVerification } from "@/lib/content/verification";

export type ContentStatus = "draft" | "review" | "published" | "archived";

/** The columns of an existing `content_items` row the decision depends on. */
export interface ExistingItem {
  id: string;
  domain: string;
  title: string;
  bodyMd: string;
  sourceRef: string;
  sourceUrl: string | null;
  sourceId: string | null;
  sourceRetrievedAt: string | null;
  contentHash: string;
  sourceKey: string | null;
  status: ContentStatus;
  version: number;
  lastEditedBy: string | null;
  submittedBy: string | null;
  submittedVersion: number | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
}

/** The repository file's contribution to the decision. */
export interface IngestFile {
  domain: string;
  title: string;
  bodyMd: string;
  sourceRef: string;
  sourceUrl: string | null;
  sourceId: string | null;
  sourceRetrievedAt: string | null;
  contentHash: string;
  sourceKey: string;
}

export interface StoredChunk {
  chunkText: string;
  embeddingGeneration: string;
}

export type IngestAction =
  /** Not publishable. `write` is false when the stored draft already matches. */
  | { kind: "hold-draft"; write: boolean; version: number; reasons: string[] }
  /** Stored row and vectors already match the file. */
  | { kind: "skip-unchanged" }
  /** An editor archived this item and the file has not changed since. */
  | { kind: "skip-archived" }
  /**
   * Publish. `reindex` is false when the stored vectors already match the file
   * and only the item's metadata drifted — that path skips the embedding call.
   * `changed` drives the version bump and the `updated_at` stamp.
   */
  | { kind: "publish"; version: number; reindex: boolean; changed: boolean };

/** Do the stored vectors already match these chunks, in this embedding space? */
export function sameChunks(
  stored: readonly StoredChunk[],
  expected: readonly string[],
  generation: string,
): boolean {
  if (
    stored.length !== expected.length ||
    stored.some((chunk) => chunk.embeddingGeneration !== generation)
  ) {
    return false;
  }

  const storedText = stored.map((chunk) => chunk.chunkText).sort();
  const expectedText = [...expected].sort();
  return storedText.every((text, index) => text === expectedText[index]);
}

/**
 * Would writing this file change the stored row? Covers governance columns as
 * well as body text, so a row whose review metadata drifted is rewritten even
 * when its prose is untouched.
 */
export function contentChanged(
  existing: ExistingItem | undefined,
  verification: ContentVerification,
  file: IngestFile,
  provenance: { reviewedBy: string | null; reviewedAt: Date | null },
): boolean {
  if (!existing) return true;

  const expectedSubmittedBy = verification.publishable ? "repository-ingest" : null;
  const expectedSubmittedVersion = verification.publishable ? existing.version : null;

  return (
    existing.domain !== file.domain ||
    existing.title !== file.title ||
    existing.bodyMd !== file.bodyMd ||
    existing.sourceRef !== file.sourceRef ||
    existing.sourceUrl !== file.sourceUrl ||
    existing.sourceId !== file.sourceId ||
    existing.sourceRetrievedAt !== file.sourceRetrievedAt ||
    // contentHash already covers the excerpt (see content/hash.ts).
    existing.contentHash !== file.contentHash ||
    existing.status !== verification.status ||
    existing.lastEditedBy !== "repository-source" ||
    existing.submittedBy !== expectedSubmittedBy ||
    existing.submittedVersion !== expectedSubmittedVersion ||
    existing.reviewedBy !== provenance.reviewedBy ||
    (existing.reviewedAt?.getTime() ?? null) !==
      (provenance.reviewedAt?.getTime() ?? null)
  );
}

export function planIngest(input: {
  existing?: ExistingItem;
  verification: ContentVerification;
  file: IngestFile;
  storedChunks: readonly StoredChunk[];
  /** `chunkMarkdown(file.bodyMd)`; ignored unless the file is publishable. */
  chunks: readonly string[];
  embeddingGeneration: string;
  /** Governance identity the ingester would write. Null for unpublishable files. */
  provenance: { reviewedBy: string | null; reviewedAt: Date | null };
}): IngestAction {
  const {
    existing,
    verification,
    file,
    storedChunks,
    chunks,
    embeddingGeneration,
    provenance,
  } = input;

  const changed = contentChanged(existing, verification, file, provenance);
  const nextVersion = existing
    ? changed
      ? existing.version + 1
      : existing.version
    : 1;

  // An editor archived this item in the CMS to take it out of retrieval. Left
  // alone, the next ingest would re-draft or republish it and undo that. An
  // *edited* file falls through and republishes — that is the "you fixed it"
  // path; an untouched file stays archived.
  if (
    existing?.status === "archived" &&
    existing.contentHash === file.contentHash
  ) {
    return { kind: "skip-archived" };
  }

  if (!verification.publishable) {
    const draftIsCurrent = Boolean(
      existing &&
        !changed &&
        existing.sourceKey === file.sourceKey &&
        storedChunks.length === 0,
    );
    return {
      kind: "hold-draft",
      write: !draftIsCurrent,
      version: nextVersion,
      reasons: verification.reasons,
    };
  }

  const indexIsCurrent =
    Boolean(existing) && sameChunks(storedChunks, chunks, embeddingGeneration);

  if (existing && indexIsCurrent) {
    if (changed || existing.sourceKey !== file.sourceKey) {
      return { kind: "publish", version: nextVersion, reindex: false, changed };
    }
    return { kind: "skip-unchanged" };
  }

  return { kind: "publish", version: nextVersion, reindex: true, changed };
}
