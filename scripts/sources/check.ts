/**
 * Has any source changed since we last read it?
 *
 * Guidance and legislation are amended. An item derived from a stale snapshot
 * keeps telling workers something that is no longer true, so this compares the
 * live document against the digest recorded when the snapshot was taken and
 * names the knowledge items that would need re-checking.
 *
 * Run with: pnpm sources:check
 */
import "../env";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  SOURCE_DOMAINS,
  loadSourceRegistry,
  staleSources,
} from "@/lib/content/sources";
import { digestBytes } from "@/lib/content/snapshot";
import { fetchPublicDocument } from "./http";

/** Corpus files grouped by the source they were derived from. */
function itemsBySource(): Map<string, string[]> {
  const bySource = new Map<string, string[]>();
  for (const domain of SOURCE_DOMAINS) {
    const dir = path.join(process.cwd(), "content", domain);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const file of files) {
      const raw = readFileSync(path.join(dir, file), "utf8");
      const match = raw.match(/^source_id:\s*(.+)$/m);
      if (!match) continue;
      const id = match[1].trim();
      bySource.set(id, [...(bySource.get(id) ?? []), `content/${domain}/${file}`]);
    }
  }
  return bySource;
}

async function main() {
  const registry = loadSourceRegistry();
  const affected = itemsBySource();
  const drifted: string[] = [];
  const errors: string[] = [];
  let checked = 0;
  let unverifiable = 0;

  for (const entry of registry) {
    if (entry.fetchPolicy !== "automated" || !entry.snapshotSha256) {
      unverifiable += 1;
      continue;
    }

    try {
      const { bytes } = await fetchPublicDocument(entry.canonicalUrl, {
        crawlDelaySeconds: entry.crawlDelaySeconds,
      });
      checked += 1;
      const sha = digestBytes(bytes);
      if (sha !== entry.snapshotSha256) {
        drifted.push(entry.id);
        console.error(`CHANGED ${entry.id} — ${entry.canonicalUrl}`);
        console.error(`  snapshot ${entry.snapshotSha256.slice(0, 12)}… → live ${sha.slice(0, 12)}…`);
        for (const file of affected.get(entry.id) ?? []) {
          console.error(`  re-verify ${file}`);
        }
      } else {
        console.log(`ok      ${entry.id}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${entry.id}: ${message}`);
      console.error(`ERROR   ${entry.id} — ${message}`);
    }
  }

  const stale = staleSources(new Date(), registry);
  for (const entry of stale) {
    console.warn(
      `DUE     ${entry.id} — recheckAfter ${entry.recheckAfter} has passed; read it again and update retrievedAt`,
    );
  }

  console.log(
    `\n${checked} source(s) checked; ${drifted.length} changed; ${errors.length} error(s); ${stale.length} due for re-reading; ${unverifiable} not automatically verifiable.`,
  );
  process.exit(drifted.length > 0 || errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
