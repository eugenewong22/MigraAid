/**
 * Content governance — the sustainability mechanism.
 *
 * Partner-NGO volunteers move knowledge-base items through
 * draft → review → published. Publishing re-chunks and re-embeds the item, so
 * the vector index never drifts from the human-approved content. Every mutation
 * is written to the audit log.
 */
import { desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { contentItems, contentChunks, auditLog } from "@/lib/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import { chunkMarkdown } from "@/lib/rag/chunk";
import type { Domain } from "@/lib/rag/types";

export async function writeAudit(
  actor: string,
  action: string,
  entity: string,
  entityId: string,
): Promise<void> {
  await getDb().insert(auditLog).values({ actor, action, entity, entityId });
}

export async function listContent() {
  return getDb().select().from(contentItems).orderBy(desc(contentItems.updatedAt));
}

export async function createDraft(
  input: { domain: Domain; title: string; bodyMd: string; sourceRef: string },
  actor: string,
) {
  const contentHash = createHash("sha256").update(input.bodyMd).digest("hex");
  const [item] = await getDb()
    .insert(contentItems)
    .values({ ...input, status: "draft", contentHash })
    .returning({ id: contentItems.id });
  await writeAudit(actor, "create_draft", "content_item", item.id);
  return item;
}

export async function submitForReview(id: string, actor: string) {
  await getDb()
    .update(contentItems)
    .set({ status: "review", updatedAt: new Date() })
    .where(eq(contentItems.id, id));
  await writeAudit(actor, "submit_for_review", "content_item", id);
}

/** Publish + re-embed: the index is rebuilt from the approved body every time. */
export async function publishContent(id: string, actor: string) {
  const db = getDb();
  const [item] = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.id, id))
    .limit(1);
  if (!item) throw new Error("Content not found");

  await db.delete(contentChunks).where(eq(contentChunks.contentItemId, id));
  const chunks = chunkMarkdown(item.bodyMd);
  const embeddings = await getEmbedder().embed(chunks, { inputType: "document" });
  await db.insert(contentChunks).values(
    chunks.map((text, i) => ({
      contentItemId: id,
      chunkText: text,
      embedding: embeddings[i],
      tokenCount: Math.ceil(text.length / 4),
    })),
  );

  await db
    .update(contentItems)
    .set({ status: "published", updatedAt: new Date() })
    .where(eq(contentItems.id, id));
  await writeAudit(actor, "publish", "content_item", id);
  return { chunks: chunks.length };
}

/** Archive + de-index (removes it from retrieval). */
export async function archiveContent(id: string, actor: string) {
  const db = getDb();
  await db.delete(contentChunks).where(eq(contentChunks.contentItemId, id));
  await db
    .update(contentItems)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(contentItems.id, id));
  await writeAudit(actor, "archive", "content_item", id);
}
