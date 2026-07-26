/**
 * Archive every repository-managed knowledge item, de-indexing the corpus.
 *
 * This is the undo for an ingest: it returns the assistant to refusing every
 * question, which is the safe state. It is reversible — editing a file and
 * re-running `pnpm ingest` republishes it (the ingester leaves an archived item
 * alone only while its content hash is unchanged).
 *
 * Run with: pnpm content:rollback
 */
import "../env";
import { and, eq, inArray, like } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, contentChunks, contentItems } from "@/lib/db/schema";
import { assertWritableDatabase } from "@/lib/db/write-guard";

async function main() {
  assertWritableDatabase("pnpm content:rollback");
  const db = getDb();
  const host = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).hostname
    : "(unset)";
  console.log(`Archiving repository-managed content on ${host}`);

  const managed = await db
    .select({ id: contentItems.id, sourceKey: contentItems.sourceKey })
    .from(contentItems)
    .where(
      and(
        like(contentItems.sourceKey, "content/%"),
        eq(contentItems.status, "published"),
      ),
    );

  if (managed.length === 0) {
    console.log("Nothing published to archive.");
    process.exit(0);
  }

  const ids = managed.map((item) => item.id);
  await db.transaction(async (tx) => {
    await tx
      .update(contentItems)
      .set({ status: "archived", updatedAt: new Date() })
      .where(inArray(contentItems.id, ids));
    await tx
      .delete(contentChunks)
      .where(inArray(contentChunks.contentItemId, ids));
    await tx.insert(auditLog).values(
      managed.map((item) => ({
        actor: "repository-rollback",
        action: "rollback_archive_content",
        entity: "content_item",
        entityId: item.id,
        metadata: { sourceKey: item.sourceKey },
      })),
    );
  });

  console.log(`Archived ${managed.length} item(s) and deleted their vectors.`);
  console.log("The assistant will now refuse every question until re-ingested.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
