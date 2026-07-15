/**
 * Ingestion pipeline: content/<domain>/*.md → chunk → embed → upsert to pgvector.
 *
 * Idempotent: each source file has a stable source key. Re-running this command
 * updates that item and atomically replaces its chunks instead of leaving stale
 * or duplicate vectors behind. A repository file is indexed only when its
 * frontmatter passes the explicit human-review gate; every other file is stored
 * as a draft and de-indexed.
 *
 * Run with: pnpm ingest   (needs DATABASE_URL + VOYAGE_API_KEY or OPENAI_API_KEY)
 */
import "../env";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, like, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, contentItems, contentChunks } from "@/lib/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import { chunkMarkdown } from "@/lib/rag/chunk";
import { verifyContentFrontmatter } from "@/lib/content/verification";

const DOMAINS = [
  "legal_rights",
  "healthcare",
  "housing",
  "financial",
  "settlement",
] as const;
type Domain = (typeof DOMAINS)[number];

const CONTENT_DIR = path.join(process.cwd(), "content");

function isDomain(value: string): value is Domain {
  return (DOMAINS as readonly string[]).includes(value);
}

function sameChunks(
  stored: Array<{ chunkText: string; embeddingGeneration: string }>,
  expected: string[],
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

function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: match[2].trim() };
}

async function main() {
  const db = getDb();
  const embedder = getEmbedder();
  const ingestionStartedAt = new Date();

  let domains: string[];
  try {
    domains = await readdir(CONTENT_DIR);
  } catch {
    console.error(`No content/ directory at ${CONTENT_DIR}`);
    process.exit(1);
  }

  let ingested = 0;
  let heldAsDraft = 0;
  const seenSourceKeys = new Set<string>();
  for (const domain of domains) {
    if (!isDomain(domain)) continue;
    const dir = path.join(CONTENT_DIR, domain);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const raw = await readFile(path.join(dir, file), "utf8");
      const { meta, body } = parseFrontmatter(raw);
      const verification = verifyContentFrontmatter(meta, ingestionStartedAt);
      const reviewedAt = verification.reviewedAt
        ? new Date(`${verification.reviewedAt}T00:00:00.000Z`)
        : null;
      const expectedReviewedBy = verification.publishable
        ? (verification.reviewedBy ?? null)
        : null;
      const expectedReviewedAt = verification.publishable ? reviewedAt : null;
      const title = meta.title ?? file.replace(/\.md$/, "");
      // Drafts may retain a descriptive fallback for volunteer editing, but that
      // fallback never satisfies the publication verifier above.
      const sourceRef =
        verification.sourceRef ?? verification.sourceUrl ?? meta.source_ref ?? title;
      const sourceUrl = verification.sourceUrl ?? null;
      const contentHash = createHash("sha256").update(body).digest("hex");
      const sourceKey = path.posix.join("content", domain, file);
      seenSourceKeys.add(sourceKey);

      let [existing] = await db
        .select()
        .from(contentItems)
        .where(eq(contentItems.sourceKey, sourceKey))
        .limit(1);

      // Adopt rows created by the pre-source-key ingester rather than duplicating
      // them. Restrict this fallback to published rows with matching identity.
      if (!existing) {
        [existing] = await db
          .select()
          .from(contentItems)
          .where(
            and(
              isNull(contentItems.sourceKey),
              eq(contentItems.status, "published"),
              eq(contentItems.domain, domain),
              or(
                eq(contentItems.contentHash, contentHash),
                and(
                  eq(contentItems.title, title),
                  eq(contentItems.sourceRef, sourceRef),
                ),
              ),
            ),
          )
          .limit(1);
      }

      const storedChunks = existing
        ? await db
            .select({
              chunkText: contentChunks.chunkText,
              embeddingGeneration: contentChunks.embeddingGeneration,
            })
            .from(contentChunks)
            .where(eq(contentChunks.contentItemId, existing.id))
        : [];

      const contentChanged =
        !existing ||
        existing.domain !== domain ||
        existing.title !== title ||
        existing.bodyMd !== body ||
        existing.sourceRef !== sourceRef ||
        existing.sourceUrl !== sourceUrl ||
        existing.contentHash !== contentHash ||
        existing.status !== verification.status ||
        existing.lastEditedBy !== "repository-source" ||
        existing.submittedBy !==
          (verification.publishable ? "repository-ingest" : null) ||
        existing.submittedVersion !==
          (verification.publishable ? existing.version : null) ||
        existing.reviewedBy !== expectedReviewedBy ||
        (existing.reviewedAt?.getTime() ?? null) !==
          (expectedReviewedAt?.getTime() ?? null);

      if (!verification.publishable) {
        const draftIsCurrent =
          existing &&
          !contentChanged &&
          existing.sourceKey === sourceKey &&
          storedChunks.length === 0;

        if (!draftIsCurrent) {
          await db.transaction(async (tx) => {
            let itemId: string;
            if (existing) {
              itemId = existing.id;
              const version = contentChanged
                ? existing.version + 1
                : existing.version;
              await tx
                .update(contentItems)
                .set({
                  domain,
                  title,
                  bodyMd: body,
                  sourceRef,
                  sourceUrl,
                  status: "draft",
                  contentHash,
                  sourceKey,
                  version,
                  lastEditedBy: "repository-source",
                  submittedBy: null,
                  submittedVersion: null,
                  reviewedBy: null,
                  reviewedAt: null,
                  reviewNote: null,
                  updatedAt: new Date(),
                })
                .where(eq(contentItems.id, itemId));
            } else {
              const [item] = await tx
                .insert(contentItems)
                .values({
                  domain,
                  title,
                  bodyMd: body,
                  sourceRef,
                  sourceUrl,
                  status: "draft",
                  contentHash,
                  sourceKey,
                  lastEditedBy: "repository-source",
                })
                .returning({ id: contentItems.id });
              itemId = item.id;
            }

            // This also removes vectors left by the legacy seed ingester when a
            // previously published file no longer carries valid review evidence.
            await tx
              .delete(contentChunks)
              .where(eq(contentChunks.contentItemId, itemId));
            await tx.insert(auditLog).values({
              actor: "repository-ingest",
              action: "hold_unverified_content",
              entity: "content_item",
              entityId: itemId,
              metadata: { sourceKey, reasons: verification.reasons },
            });
          });
        }

        heldAsDraft += 1;
        console.warn(
          `${draftIsCurrent ? "skip" : "drafted"} (not indexed): ${domain}/${file} — ${verification.reasons.join("; ")}`,
        );
        continue;
      }

      const chunks = chunkMarkdown(body);
      if (chunks.length === 0) {
        throw new Error(`${sourceKey} contains no indexable content`);
      }
      const indexIsCurrent =
        existing && sameChunks(storedChunks, chunks, embedder.generation);

      if (existing && indexIsCurrent) {
        if (contentChanged || existing.sourceKey !== sourceKey) {
          const version = contentChanged
            ? existing.version + 1
            : existing.version;
          await db.transaction(async (tx) => {
            await tx
              .update(contentItems)
              .set({
                domain,
                title,
                bodyMd: body,
                sourceRef,
                sourceUrl,
                status: "published",
                contentHash,
                sourceKey,
                version,
                lastEditedBy: "repository-source",
                submittedBy: "repository-ingest",
                submittedVersion: version,
                reviewedBy: verification.reviewedBy,
                reviewedAt,
                reviewNote: "Approved in repository governance metadata",
                updatedAt: contentChanged ? new Date() : existing.updatedAt,
              })
              .where(eq(contentItems.id, existing.id));
            await tx.insert(auditLog).values({
              actor: verification.reviewedBy ?? "repository-reviewer",
              action: "ingest_verified_content",
              entity: "content_item",
              entityId: existing.id,
              metadata: {
                sourceKey,
                version,
                reviewedAt: verification.reviewedAt,
                contentHash,
              },
            });
          });
        }
        console.log(`skip (unchanged): ${domain}/${file}`);
        continue;
      }

      const embeddings = await embedder.embed(chunks, { inputType: "document" });
      await db.transaction(async (tx) => {
        let itemId: string;
        if (existing) {
          itemId = existing.id;
          const version = contentChanged
            ? existing.version + 1
            : existing.version;
          await tx
            .update(contentItems)
            .set({
              domain,
              title,
              bodyMd: body,
              sourceRef,
              sourceUrl,
              status: "published",
              contentHash,
              sourceKey,
              version,
              lastEditedBy: "repository-source",
              submittedBy: "repository-ingest",
              submittedVersion: version,
              reviewedBy: verification.reviewedBy,
              reviewedAt,
              reviewNote: "Approved in repository governance metadata",
              updatedAt: new Date(),
            })
            .where(eq(contentItems.id, itemId));
        } else {
          const [item] = await tx
            .insert(contentItems)
            .values({
              domain,
              title,
              bodyMd: body,
              sourceRef,
              sourceUrl,
              status: "published",
              contentHash,
              sourceKey,
              lastEditedBy: "repository-source",
              submittedBy: "repository-ingest",
              submittedVersion: 1,
              reviewedBy: verification.reviewedBy,
              reviewedAt,
              reviewNote: "Approved in repository governance metadata",
            })
            .returning({ id: contentItems.id });
          itemId = item.id;
        }

        await tx.delete(contentChunks).where(eq(contentChunks.contentItemId, itemId));
        await tx.insert(contentChunks).values(
          chunks.map((text, index) => ({
            contentItemId: itemId,
            chunkText: text,
            embedding: embeddings[index],
            embeddingGeneration: embedder.generation,
            tokenCount: Math.ceil(text.length / 4),
          })),
        );
        await tx.insert(auditLog).values({
          actor: verification.reviewedBy ?? "repository-reviewer",
          action: existing ? "reindex_verified_content" : "ingest_verified_content",
          entity: "content_item",
          entityId: itemId,
          metadata: {
            sourceKey,
            reviewedAt: verification.reviewedAt,
            contentHash,
            embeddingGeneration: embedder.generation,
          },
        });
      });
      ingested += 1;
      console.log(
        `${existing ? "reindexed" : "ingested"}: ${domain}/${file} (${chunks.length} chunks, ${embedder.generation})`,
      );
    }
  }

  // A removed source must not leave obsolete guidance retrievable. This runs
  // only after every current file completed successfully, so a failed ingest
  // never causes a partial scan to archive otherwise valid content.
  const managedItems = await db
    .select({ id: contentItems.id, sourceKey: contentItems.sourceKey })
    .from(contentItems)
    .where(like(contentItems.sourceKey, "content/%"));
  const staleItems = managedItems.filter(
    (item): item is { id: string; sourceKey: string } =>
      item.sourceKey !== null && !seenSourceKeys.has(item.sourceKey),
  );
  if (staleItems.length > 0) {
    const staleIds = staleItems.map((item) => item.id);
    await db.transaction(async (tx) => {
      await tx
        .update(contentItems)
        .set({ status: "archived", updatedAt: new Date() })
        .where(inArray(contentItems.id, staleIds));
      await tx
        .delete(contentChunks)
        .where(inArray(contentChunks.contentItemId, staleIds));
      await tx.insert(auditLog).values(
        staleItems.map((item) => ({
          actor: "repository-ingest",
          action: "archive_removed_source",
          entity: "content_item",
          entityId: item.id,
          metadata: { sourceKey: item.sourceKey },
        })),
      );
    });
    for (const item of staleItems) {
      console.log(`archived (source removed): ${item.sourceKey}`);
    }
  }

  console.log(
    `\nDone. ${ingested} verified item(s) ingested or reindexed; ${heldAsDraft} unverified item(s) held as draft; ${staleItems.length} removed source(s) archived.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
