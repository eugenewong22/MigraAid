/**
 * Undo a `content:rollback`, so the next ingest republishes the corpus.
 *
 * `content:rollback` archives every repository-managed item. The ingester then
 * deliberately leaves archived items alone — an editor who archived something
 * in the CMS must not have it resurrected by the next deploy — and it cannot
 * tell that apart from a rollback that archived everything at once. So after a
 * rollback, `pnpm ingest` skips all of it and the index stays empty.
 *
 * The documented escape ("edit the file to republish it") is fine for one item
 * and useless for eighty-seven. This moves them back to `draft`, which the
 * ingester treats as ordinary drift and republishes.
 *
 * Only touches items whose `source_key` is repository-managed, so anything an
 * editor archived through the CMS by hand stays archived.
 *
 * Run with: pnpm content:restore
 */
import "../env";
import { and, eq, like } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, contentItems } from "@/lib/db/schema";
import { assertWritableDatabase } from "@/lib/db/write-guard";

async function main() {
  assertWritableDatabase("pnpm content:restore");
  const db = getDb();
  const host = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).hostname
    : "(unset)";
  console.log(`Restoring repository-managed content on ${host}`);

  const archived = await db
    .select({ id: contentItems.id, sourceKey: contentItems.sourceKey })
    .from(contentItems)
    .where(
      and(
        like(contentItems.sourceKey, "content/%"),
        eq(contentItems.status, "archived"),
      ),
    );

  if (archived.length === 0) {
    console.log("No archived repository content to restore.");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    for (const item of archived) {
      await tx
        .update(contentItems)
        .set({ status: "draft", updatedAt: new Date() })
        .where(eq(contentItems.id, item.id));
    }
    await tx.insert(auditLog).values(
      archived.map((item) => ({
        actor: "repository-restore",
        action: "restore_archived_content",
        entity: "content_item",
        entityId: item.id,
        metadata: { sourceKey: item.sourceKey },
      })),
    );
  });

  console.log(`Moved ${archived.length} item(s) back to draft.`);
  console.log("Run `pnpm ingest` to re-embed and publish them.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
