/**
 * The registry of public documents the knowledge base derives from.
 *
 * Every knowledge item names a `source_id` here, so a claim shown to a worker
 * can always be traced to the document it came from, the authority that issued
 * it, and the snapshot proving what that document said when it was read.
 *
 * The registry lives beside the corpus in `content/sources.json` rather than in
 * Postgres: it is editorial data reviewed in the same diff as the items derived
 * from it, and keeping it out of the database avoids a migration, an RLS policy,
 * and an admin CRUD screen that nothing needs yet.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseCalendarDate } from "@/lib/content/dates";

export const SOURCE_DOMAINS = [
  "legal_rights",
  "healthcare",
  "housing",
  "financial",
  "settlement",
] as const;

export const SOURCE_TIERS = [
  /** Primary legislation and subsidiary regulations. */
  "statute",
  /** Operational guidance published by a government body. */
  "government_guidance",
  /** Material published by a partner NGO. */
  "ngo_guide",
  /** Other public interest information (health, banking, remittance). */
  "public_information",
] as const;

const calendarDate = z
  .string()
  .refine((value) => parseCalendarDate(value) !== null, {
    message: "must be a real YYYY-MM-DD calendar date",
  });

const httpsUrl = z.string().refine(
  (value) => {
    try {
      const parsed = new URL(value);
      return (
        parsed.protocol === "https:" &&
        Boolean(parsed.hostname) &&
        !parsed.username &&
        !parsed.password
      );
    } catch {
      return false;
    }
  },
  { message: "must be an absolute HTTPS URL without embedded credentials" },
);

const nonPlaceholderText = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !/^(?:todo|tbd|unknown|n\/a|none)$/i.test(value), {
    message: "must not be placeholder text",
  });

/**
 * What licence the source declares, and whether a human has actually read those
 * terms. `verifiedBy` / `verifiedAt` are optional because an unverified source
 * is the honest default — the licence gate simply refuses to quote it verbatim.
 */
const licenceSchema = z.object({
  id: nonPlaceholderText,
  name: nonPlaceholderText,
  url: httpsUrl,
  verifiedBy: nonPlaceholderText.optional(),
  verifiedAt: calendarDate.optional(),
  note: z.string().trim().min(1),
});

export const sourceEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be a lowercase slug"),
    title: nonPlaceholderText,
    issuingAuthority: nonPlaceholderText,
    citationLabel: nonPlaceholderText,
    tier: z.enum(SOURCE_TIERS),
    domains: z.array(z.enum(SOURCE_DOMAINS)).min(1),
    canonicalUrl: httpsUrl,
    licence: licenceSchema,
    fetchPolicy: z.enum(["manual", "automated"]).default("manual"),
    robotsCheckedAt: calendarDate.optional(),
    /** `Crawl-delay` this host publishes, in seconds. Honoured when fetching. */
    crawlDelaySeconds: z.number().int().min(0).max(300).optional(),
    /** What the robots.txt check found, in prose. */
    robotsNote: z.string().trim().min(1).optional(),
    retrievedAt: calendarDate.optional(),
    recheckAfter: calendarDate.optional(),
    snapshotPath: z.string().trim().min(1).optional(),
    snapshotSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "must be a lowercase sha256 hex digest")
      .optional(),
    snapshotScope: z.enum(["full", "sections"]).default("full"),
    sections: z.array(z.string().trim().min(1)).optional(),
  })
  .superRefine((entry, ctx) => {
    // Automated fetching is opt-in per host and requires someone to have read
    // that host's robots.txt and terms first.
    if (entry.fetchPolicy === "automated" && !entry.robotsCheckedAt) {
      ctx.addIssue({
        code: "custom",
        path: ["robotsCheckedAt"],
        message: 'required when fetchPolicy is "automated"',
      });
    }
    // A snapshot without its digest cannot be checked for drift, and a digest
    // without a snapshot refers to nothing.
    if (Boolean(entry.snapshotPath) !== Boolean(entry.snapshotSha256)) {
      ctx.addIssue({
        code: "custom",
        path: ["snapshotSha256"],
        message: "snapshotPath and snapshotSha256 must be set together",
      });
    }
    if (entry.snapshotScope === "sections" && !entry.sections?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["sections"],
        message: 'required when snapshotScope is "sections"',
      });
    }
  });

export const sourceRegistrySchema = z
  .array(sourceEntrySchema)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `duplicate source id "${entry.id}"`,
        });
      }
      seen.add(entry.id);
    }
  });

export type SourceEntry = z.infer<typeof sourceEntrySchema>;

export const SOURCES_PATH = path.join(process.cwd(), "content", "sources.json");

let cached: readonly SourceEntry[] | null = null;

/** Parse a registry from raw JSON text. Throws with a readable message. */
export function parseSourceRegistry(raw: string): readonly SourceEntry[] {
  const parsed = sourceRegistrySchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `content/sources.json is invalid:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function loadSourceRegistry(): readonly SourceEntry[] {
  cached ??= parseSourceRegistry(readFileSync(SOURCES_PATH, "utf8"));
  return cached;
}

export function getSource(id: string | undefined): SourceEntry | undefined {
  if (!id) return undefined;
  return loadSourceRegistry().find((entry) => entry.id === id);
}

/** Entries whose `recheckAfter` has passed — reported by the scheduled job. */
export function staleSources(
  now: Date,
  entries: readonly SourceEntry[] = loadSourceRegistry(),
): readonly SourceEntry[] {
  return entries.filter((entry) => {
    const due = parseCalendarDate(entry.recheckAfter);
    return due !== null && due.getTime() < now.getTime();
  });
}
