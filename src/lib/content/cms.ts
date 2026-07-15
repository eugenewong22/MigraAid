/**
 * Content governance — the sustainability mechanism.
 *
 * Partner-NGO volunteers move knowledge-base items through
 * draft → review → published. Publishing re-chunks and re-embeds the item, so
 * the vector index never drifts from the human-approved content. Every mutation
 * is written to the audit log.
 */
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { contentItems, contentChunks, auditLog } from "@/lib/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import { chunkMarkdown } from "@/lib/rag/chunk";
import type { Domain } from "@/lib/rag/types";

export function isIndependentReviewer(
  item: { submittedBy: string | null; lastEditedBy: string | null },
  actor: string,
): boolean {
  return Boolean(
    item.submittedBy &&
      item.submittedBy !== actor &&
      item.lastEditedBy !== actor,
  );
}

export async function writeAudit(
  actor: string,
  action: string,
  entity: string,
  entityId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await getDb()
    .insert(auditLog)
    .values({ actor, action, entity, entityId, metadata });
}

export async function listContent() {
  return getDb().select().from(contentItems).orderBy(desc(contentItems.updatedAt));
}

export async function listAudit(limit = 200) {
  return getDb().select().from(auditLog).orderBy(desc(auditLog.at)).limit(limit);
}

export async function createDraft(
  input: {
    domain: Domain;
    title: string;
    bodyMd: string;
    sourceRef: string;
    sourceUrl?: string;
  },
  actor: string,
) {
  const contentHash = createHash("sha256").update(input.bodyMd).digest("hex");
  return getDb().transaction(async (tx) => {
    const [item] = await tx
      .insert(contentItems)
      .values({
        ...input,
        sourceUrl: input.sourceUrl ?? null,
        status: "draft",
        contentHash,
        lastEditedBy: actor,
      })
      .returning({ id: contentItems.id, version: contentItems.version });
    await tx.insert(auditLog).values({
      actor,
      action: "create_draft",
      entity: "content_item",
      entityId: item.id,
      metadata: { version: item.version },
    });
    return item;
  });
}

export async function updateDraft(
  id: string,
  input: {
    domain: Domain;
    title: string;
    bodyMd: string;
    sourceRef: string;
    sourceUrl?: string;
  },
  expectedVersion: number,
  actor: string,
) {
  const contentHash = createHash("sha256").update(input.bodyMd).digest("hex");
  return getDb().transaction(async (tx) => {
    const [item] = await tx
      .update(contentItems)
      .set({
        ...input,
        sourceUrl: input.sourceUrl ?? null,
        contentHash,
        version: sql`${contentItems.version} + 1`,
        lastEditedBy: actor,
        submittedBy: null,
        submittedVersion: null,
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contentItems.id, id),
          eq(contentItems.status, "draft"),
          eq(contentItems.version, expectedVersion),
        ),
      )
      .returning({ id: contentItems.id, version: contentItems.version });
    if (!item) {
      throw new Error("Draft changed since this page loaded; refresh before editing");
    }
    await tx.insert(auditLog).values({
      actor,
      action: "update_draft",
      entity: "content_item",
      entityId: id,
      metadata: { fromVersion: expectedVersion, toVersion: item.version },
    });
    return item;
  });
}

export async function submitForReview(id: string, actor: string) {
  await getDb().transaction(async (tx) => {
    const [item] = await tx
      .update(contentItems)
      .set({
        status: "review",
        submittedBy: actor,
        submittedVersion: sql`${contentItems.version}`,
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        updatedAt: new Date(),
      })
      .where(and(eq(contentItems.id, id), eq(contentItems.status, "draft")))
      .returning({ id: contentItems.id, version: contentItems.version });
    if (!item) throw new Error("Only draft content can be submitted for review");
    await tx.insert(auditLog).values({
      actor,
      action: "submit_for_review",
      entity: "content_item",
      entityId: id,
      metadata: { version: item.version },
    });
  });
}

/** Publish + re-embed: the index is rebuilt from the approved body every time. */
export async function publishContent(
  id: string,
  expectedVersion: number,
  actor: string,
) {
  const db = getDb();
  const [item] = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.id, id))
    .limit(1);
  if (!item) throw new Error("Content not found");
  if (item.status !== "review") {
    throw new Error("Content must be reviewed before it can be published");
  }
  if (
    item.submittedVersion !== item.version ||
    item.version !== expectedVersion ||
    !item.submittedBy
  ) {
    throw new Error("Only the exact submitted version can be published");
  }
  if (!isIndependentReviewer(item, actor)) {
    throw new Error("A different reviewer must approve this content");
  }

  const chunks = chunkMarkdown(item.bodyMd);
  if (chunks.length === 0) throw new Error("Content body cannot be empty");
  const embedder = getEmbedder();
  const embeddings = await embedder.embed(chunks, { inputType: "document" });
  await db.transaction(async (tx) => {
    const [published] = await tx
      .update(contentItems)
      .set({
        status: "published",
        reviewedBy: actor,
        reviewedAt: new Date(),
        reviewNote: "Approved for publication",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contentItems.id, id),
          eq(contentItems.status, "review"),
          eq(contentItems.version, expectedVersion),
          eq(contentItems.submittedVersion, expectedVersion),
          ne(contentItems.submittedBy, actor),
        ),
      )
      .returning({ id: contentItems.id });
    if (!published) throw new Error("Content is no longer awaiting review");
    await tx.delete(contentChunks).where(eq(contentChunks.contentItemId, id));
    await tx.insert(contentChunks).values(
      chunks.map((text, i) => ({
        contentItemId: id,
        chunkText: text,
        embedding: embeddings[i],
        embeddingGeneration: embedder.generation,
        tokenCount: Math.ceil(text.length / 4),
      })),
    );
    await tx.insert(auditLog).values({
      actor,
      action: "publish",
      entity: "content_item",
      entityId: id,
      metadata: {
        version: expectedVersion,
        submittedBy: item.submittedBy,
        contentHash: item.contentHash,
      },
    });
  });
  return { chunks: chunks.length };
}

/** Return reviewed content to draft with an auditable reason. */
export async function requestContentChanges(
  id: string,
  expectedVersion: number,
  note: string,
  actor: string,
) {
  return getDb().transaction(async (tx) => {
    const [current] = await tx
      .select({
        submittedBy: contentItems.submittedBy,
        lastEditedBy: contentItems.lastEditedBy,
      })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.id, id),
          eq(contentItems.status, "review"),
          eq(contentItems.version, expectedVersion),
        ),
      )
      .limit(1);
    if (!current) throw new Error("Content is no longer awaiting this review");
    if (!isIndependentReviewer(current, actor)) {
      throw new Error("A different reviewer must review this content");
    }

    const [item] = await tx
      .update(contentItems)
      .set({
        status: "draft",
        submittedBy: null,
        submittedVersion: null,
        reviewedBy: actor,
        reviewedAt: new Date(),
        reviewNote: note,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contentItems.id, id),
          eq(contentItems.status, "review"),
          eq(contentItems.version, expectedVersion),
        ),
      )
      .returning({ id: contentItems.id });
    if (!item) throw new Error("Content is no longer awaiting this review");
    await tx.insert(auditLog).values({
      actor,
      action: "request_changes",
      entity: "content_item",
      entityId: id,
      metadata: { version: expectedVersion, note },
    });
    return item;
  });
}

/** Archive + de-index (removes it from retrieval). */
export async function archiveContent(id: string, actor: string) {
  await getDb().transaction(async (tx) => {
    const [item] = await tx
      .update(contentItems)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(contentItems.id, id), sql`${contentItems.status} <> 'archived'`))
      .returning({ id: contentItems.id });
    if (!item) throw new Error("Content not found or already archived");
    await tx.delete(contentChunks).where(eq(contentChunks.contentItemId, id));
    await tx.insert(auditLog).values({
      actor,
      action: "archive",
      entity: "content_item",
      entityId: id,
      metadata: { status: "archived" },
    });
  });
}
