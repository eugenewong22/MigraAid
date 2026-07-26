/**
 * Ingestion pipeline: content/<domain>/*.md → chunk → embed → upsert to pgvector.
 *
 * Idempotent: each source file has a stable source key. Re-running this command
 * updates that item and atomically replaces its chunks instead of leaving stale
 * or duplicate vectors behind. A repository file is indexed only when its
 * frontmatter passes the publication gate; every other file is stored as a
 * draft and de-indexed.
 *
 * The decision of what to do with each file lives in `@/lib/content/ingest-plan`
 * so it can be tested without a database. This file is the driver.
 *
 * Run with: pnpm ingest   (needs DATABASE_URL + VOYAGE_API_KEY or OPENAI_API_KEY)
 */
import "../env";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNull, like, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, contentItems, contentChunks } from "@/lib/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import { chunkMarkdown } from "@/lib/rag/chunk";
import { verifyContentFrontmatter } from "@/lib/content/verification";
import {
  planIngest,
  type ExistingItem,
  type IngestFile,
} from "@/lib/content/ingest-plan";
import { lastCommitFor, resolveProvenance } from "@/lib/content/git-provenance";
import { parseFrontmatter } from "@/lib/content/frontmatter";
import { splitSourceExcerpt } from "@/lib/content/excerpt";
import { computeContentHash } from "@/lib/content/hash";
import { getSource } from "@/lib/content/sources";
import { excerptPermitted } from "@/lib/content/licence";
import { assertWritableDatabase } from "@/lib/db/write-guard";

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

async function main() {
  assertWritableDatabase("pnpm ingest");
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
  let skippedArchived = 0;
  const seenSourceKeys = new Set<string>();
  for (const domain of domains) {
    if (!isDomain(domain)) continue;
    const dir = path.join(CONTENT_DIR, domain);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const filePath = path.join(dir, file);
      const raw = await readFile(filePath, "utf8");
      const { meta, body: rawBody } = parseFrontmatter(raw);
      // The verbatim excerpt is split off before anything else touches the
      // body, so it can never reach the chunker or the embedding call.
      const { bodyMd: body, sourceExcerpt } = splitSourceExcerpt(rawBody);
      const sourceId = meta.source_id ?? null;
      const source = getSource(sourceId ?? undefined);
      if (sourceId && !source) {
        throw new Error(
          `content/${domain}/${file} names source_id "${sourceId}", which is not in content/sources.json`,
        );
      }
      // The anchor always lives in the repository: it is what a reviewer checks
      // the paraphrase against in a diff, what the drafting script writes from,
      // and what the fidelity tests assert against. Storing it in the database
      // is a separate question, because that reproduces source text in a running
      // product — so that part waits on a recorded licence verification.
      let storedExcerpt: string | null = null;
      if (sourceExcerpt) {
        const decision = excerptPermitted(source, ingestionStartedAt);
        if (decision.permitted) {
          storedExcerpt = sourceExcerpt;
        } else {
          console.warn(
            `note: ${domain}/${file} keeps its excerpt in the repository only — ${decision.reason}`,
          );
        }
      }
      const verification = verifyContentFrontmatter(meta, ingestionStartedAt);
      const commit = verification.publishable ? lastCommitFor(filePath) : null;
      // Accountability for a published item, in descending order of strength:
      // an explicit review recorded in frontmatter, then the commit that last
      // touched the file, then a generic identity when git cannot tell us.
      // Unpublishable files carry no governance identity at all.
      const provenance = resolveProvenance({ verification, commit });
      const title = meta.title ?? file.replace(/\.md$/, "");
      // Drafts may retain a descriptive fallback for volunteer editing, but that
      // fallback never satisfies the publication verifier above.
      const sourceRef =
        verification.sourceRef ?? verification.sourceUrl ?? meta.source_ref ?? title;
      const sourceUrl = verification.sourceUrl ?? null;
      const contentHash = computeContentHash({ bodyMd: body, sourceExcerpt });
      const sourceKey = path.posix.join("content", domain, file);
      seenSourceKeys.add(sourceKey);

      // A wrong link is easy to paste and hard to spot; the registry knows the
      // host this source actually lives on.
      if (source && sourceUrl) {
        const linked = new URL(sourceUrl).hostname;
        const canonical = new URL(source.canonicalUrl).hostname;
        if (linked !== canonical) {
          console.warn(
            `warn: ${domain}/${file} links ${linked} but source "${source.id}" is published on ${canonical}`,
          );
        }
      }

      const fileFields: IngestFile = {
        domain,
        title,
        bodyMd: body,
        sourceRef,
        sourceUrl,
        sourceId,
        sourceRetrievedAt: meta.source_retrieved_at ?? null,
        contentHash,
        sourceKey,
      };

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

      const chunks = chunkMarkdown(body);
      const action = planIngest({
        existing: existing as ExistingItem | undefined,
        verification,
        file: fileFields,
        storedChunks,
        chunks,
        embeddingGeneration: embedder.generation,
        provenance,
      });

      if (action.kind === "skip-unchanged") {
        console.log(`skip (unchanged): ${domain}/${file}`);
        continue;
      }

      if (action.kind === "skip-archived") {
        skippedArchived += 1;
        console.warn(
          `skip (archived in CMS): ${domain}/${file} — edit the file to republish it`,
        );
        continue;
      }

      if (action.kind === "hold-draft") {
        if (action.write) {
          await db.transaction(async (tx) => {
            let itemId: string;
            if (existing) {
              itemId = existing.id;
              await tx
                .update(contentItems)
                .set({
                  domain,
                  title,
                  bodyMd: body,
                  sourceRef,
                  sourceUrl,
                  sourceId,
                  sourceExcerpt: storedExcerpt,
                  sourceRetrievedAt: meta.source_retrieved_at ?? null,
                  status: "draft",
                  contentHash,
                  sourceKey,
                  version: action.version,
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
                  sourceId,
                  sourceExcerpt: storedExcerpt,
                  sourceRetrievedAt: meta.source_retrieved_at ?? null,
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
              metadata: { sourceKey, reasons: action.reasons },
            });
          });
        }

        heldAsDraft += 1;
        console.warn(
          `${action.write ? "drafted" : "skip"} (not indexed): ${domain}/${file} — ${action.reasons.join("; ")}`,
        );
        continue;
      }

      if (chunks.length === 0) {
        throw new Error(`${sourceKey} contains no indexable content`);
      }

      const publishedFields = {
        domain,
        title,
        bodyMd: body,
        sourceRef,
        sourceUrl,
        sourceId,
        sourceExcerpt: storedExcerpt,
        sourceRetrievedAt: meta.source_retrieved_at ?? null,
        status: "published" as const,
        contentHash,
        sourceKey,
        version: action.version,
        lastEditedBy: "repository-source",
        submittedBy: "repository-ingest",
        submittedVersion: action.version,
        reviewedBy: provenance.reviewedBy,
        reviewedAt: provenance.reviewedAt,
        reviewNote: provenance.reviewNote,
      };
      const provenanceAudit = {
        sourceKey,
        version: action.version,
        commitSha: provenance.commitSha,
        reviewedBy: provenance.reviewedBy,
        contentHash,
      };

      // The stored vectors already match this body; only metadata drifted.
      if (!action.reindex && existing) {
        await db.transaction(async (tx) => {
          await tx
            .update(contentItems)
            .set({
              ...publishedFields,
              updatedAt: action.changed ? new Date() : existing.updatedAt,
            })
            .where(eq(contentItems.id, existing.id));
          await tx.insert(auditLog).values({
            actor: provenance.reviewedBy ?? "repository-reviewer",
            action: "ingest_verified_content",
            entity: "content_item",
            entityId: existing.id,
            metadata: provenanceAudit,
          });
        });
        console.log(`skip (unchanged): ${domain}/${file}`);
        continue;
      }

      const embeddings = await embedder.embed(chunks, { inputType: "document" });
      await db.transaction(async (tx) => {
        let itemId: string;
        if (existing) {
          itemId = existing.id;
          await tx
            .update(contentItems)
            .set({ ...publishedFields, updatedAt: new Date() })
            .where(eq(contentItems.id, itemId));
        } else {
          const [item] = await tx
            .insert(contentItems)
            .values(publishedFields)
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
          actor: provenance.reviewedBy ?? "repository-reviewer",
          action: existing ? "reindex_verified_content" : "ingest_verified_content",
          entity: "content_item",
          entityId: itemId,
          metadata: {
            ...provenanceAudit,
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
    `\nDone. ${ingested} verified item(s) ingested or reindexed; ${heldAsDraft} unverified item(s) held as draft; ${skippedArchived} archived item(s) left untouched; ${staleItems.length} removed source(s) archived.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
