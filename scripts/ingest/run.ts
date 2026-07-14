/**
 * Ingestion pipeline: content/<domain>/*.md → chunk → embed → upsert to pgvector.
 *
 * Idempotent: each source file is content-hashed, and files whose hash already
 * exists are skipped. Only `published` items are inserted (this seed corpus is
 * illustrative — production content is authored/verified via the admin CMS in M5).
 *
 * Run with: pnpm ingest   (needs DATABASE_URL + VOYAGE_API_KEY)
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contentItems, contentChunks } from "@/lib/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import { chunkMarkdown } from "@/lib/rag/chunk";

type Domain =
  | "legal_rights"
  | "healthcare"
  | "housing"
  | "financial"
  | "settlement";

const CONTENT_DIR = path.join(process.cwd(), "content");

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

  let domains: string[];
  try {
    domains = await readdir(CONTENT_DIR);
  } catch {
    console.error(`No content/ directory at ${CONTENT_DIR}`);
    process.exit(1);
  }

  let ingested = 0;
  for (const domain of domains) {
    const dir = path.join(CONTENT_DIR, domain);
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    } catch {
      continue; // not a domain directory
    }

    for (const file of files) {
      const raw = await readFile(path.join(dir, file), "utf8");
      const { meta, body } = parseFrontmatter(raw);
      const title = meta.title ?? file.replace(/\.md$/, "");
      const sourceRef = meta.source_ref ?? title;
      const contentHash = createHash("sha256").update(body).digest("hex");

      const existing = await db
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(eq(contentItems.contentHash, contentHash))
        .limit(1);
      if (existing.length) {
        console.log(`skip (unchanged): ${domain}/${file}`);
        continue;
      }

      const [item] = await db
        .insert(contentItems)
        .values({
          domain: domain as Domain,
          title,
          bodyMd: body,
          sourceRef,
          status: "published",
          contentHash,
        })
        .returning({ id: contentItems.id });

      const chunks = chunkMarkdown(body);
      const embeddings = await embedder.embed(chunks, { inputType: "document" });
      await db.insert(contentChunks).values(
        chunks.map((text, i) => ({
          contentItemId: item.id,
          chunkText: text,
          embedding: embeddings[i],
          tokenCount: Math.ceil(text.length / 4),
        })),
      );
      ingested += 1;
      console.log(`ingested: ${domain}/${file} (${chunks.length} chunks)`);
    }
  }

  console.log(`\nDone. ${ingested} item(s) ingested.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
