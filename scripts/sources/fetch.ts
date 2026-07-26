/**
 * Snapshot the public documents the knowledge base derives from.
 *
 * Only sources explicitly marked `fetchPolicy: "automated"` are fetched. The
 * default is `"manual"`, which prints an instruction instead: flipping a host to
 * automated requires a person to read that host's robots.txt and terms of use
 * and record the date on the registry entry. That is why this script asserts
 * nothing about any particular site's terms — a human decides, per host.
 *
 * Run with: pnpm sources:fetch [source-id ...]
 */
import "../env";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import {
  SOURCES_PATH,
  loadSourceRegistry,
  type SourceEntry,
} from "@/lib/content/sources";
import {
  digestBytes,
  extractSections,
  htmlToText,
  snapshotPathFor,
} from "@/lib/content/snapshot";
import { fetchPublicDocument } from "./http";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Rewrite one entry's snapshot fields in place, preserving key order. */
function updateRegistry(
  id: string,
  patch: { retrievedAt: string; snapshotPath: string; snapshotSha256: string },
): void {
  const raw = JSON.parse(readFileSync(SOURCES_PATH, "utf8")) as Array<
    Record<string, unknown>
  >;
  const entry = raw.find((item) => item.id === id);
  if (!entry) throw new Error(`source "${id}" vanished from the registry`);
  Object.assign(entry, patch);
  writeFileSync(SOURCES_PATH, `${JSON.stringify(raw, null, 2)}\n`);
}

async function snapshot(entry: SourceEntry): Promise<void> {
  const { bytes, finalUrl } = await fetchPublicDocument(entry.canonicalUrl, {
    crawlDelaySeconds: entry.crawlDelaySeconds,
  });
  const sha = digestBytes(bytes);
  const html = new TextDecoder("utf-8").decode(bytes);

  let text = htmlToText(html);
  if (entry.snapshotScope === "sections" && entry.sections?.length) {
    const { text: sectional, missing } = extractSections(text, entry.sections);
    if (missing.length > 0) {
      console.warn(
        `  warn: could not locate ${missing.join(", ")} in ${entry.id}; storing the full document instead`,
      );
    }
    if (sectional) text = sectional;
  }

  const retrievedAt = today();
  const relativePath = snapshotPathFor(entry.id, retrievedAt);
  const absolutePath = path.join(process.cwd(), relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    [
      `# Snapshot of ${entry.title}`,
      `# source_id: ${entry.id}`,
      `# canonical_url: ${entry.canonicalUrl}`,
      `# final_url: ${finalUrl}`,
      `# retrieved_at: ${retrievedAt}`,
      `# sha256_of_raw_response: ${sha}`,
      "",
      text,
      "",
    ].join("\n"),
    "utf8",
  );

  updateRegistry(entry.id, {
    retrievedAt,
    snapshotPath: relativePath,
    snapshotSha256: sha,
  });
  console.log(`  saved ${relativePath} (${text.length} chars, sha ${sha.slice(0, 12)}…)`);
}

async function main() {
  const only = new Set(process.argv.slice(2));
  const registry = loadSourceRegistry().filter(
    (entry) => only.size === 0 || only.has(entry.id),
  );

  let fetched = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const entry of registry) {
    if (entry.fetchPolicy !== "automated") {
      skipped += 1;
      console.log(
        `skip ${entry.id} — fetchPolicy is "manual". Save a snapshot by hand to ${snapshotPathFor(entry.id, today())}, or set fetchPolicy to "automated" after checking ${new URL(entry.canonicalUrl).origin}/robots.txt and its terms, recording the date in robotsCheckedAt.`,
      );
      continue;
    }

    console.log(`fetch ${entry.id} — ${entry.canonicalUrl}`);
    try {
      await snapshot(entry);
      fetched += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${entry.id}: ${message}`);
      console.error(`  failed: ${message}`);
    }
  }

  console.log(
    `\nDone. ${fetched} snapshot(s) written; ${skipped} manual source(s) skipped; ${failures.length} failure(s).`,
  );
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
