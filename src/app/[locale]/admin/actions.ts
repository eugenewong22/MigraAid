"use server";

import { revalidatePath } from "next/cache";
import {
  archiveContent,
  createDraft,
  publishContent,
  requestContentChanges,
  submitForReview,
  updateDraft,
} from "@/lib/content/cms";
import { confirmReferral } from "@/lib/referral/admin";
import { requireAdmin } from "@/lib/content/auth";
import { z } from "zod";

/** An empty form field means "not provided", not "the empty string". */
function emptyToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema,
  );
}

const DraftSchema = z.object({
  domain: z.enum(["legal_rights", "healthcare", "housing", "financial", "settlement"]),
  title: z.string().trim().min(3).max(200),
  sourceRef: z.string().trim().min(3).max(500),
  sourceUrl: emptyToUndefined(
    z
      .string()
      .trim()
      .url()
      .max(2_000)
      .refine((value) => new URL(value).protocol === "https:", {
        message: "Source URL must use HTTPS",
      })
      .optional(),
  ),
  bodyMd: z.string().trim().min(20).max(50_000),
  sourceId: emptyToUndefined(
    z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]*$/, "Source id must be a lowercase slug")
      .max(120)
      .optional(),
  ),
  sourceExcerpt: emptyToUndefined(z.string().trim().max(5_000).optional()),
  sourceRetrievedAt: emptyToUndefined(
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Retrieved date must be YYYY-MM-DD")
      .optional(),
  ),
}).superRefine((input, ctx) => {
  // The database enforces this too; failing here gives the editor a message
  // instead of a constraint violation.
  if (input.sourceExcerpt && !input.sourceId) {
    ctx.addIssue({
      code: "custom",
      path: ["sourceId"],
      message: "A verbatim excerpt requires the source it came from",
    });
  }
});
const IdSchema = z.string().uuid();
const VersionSchema = z.coerce.number().int().positive();
const ReviewNoteSchema = z.string().trim().min(3).max(2_000);
const HandoffCodeSchema = z
  .string()
  .trim()
  .min(14)
  .max(32);

export async function createDraftAction(formData: FormData) {
  const actor = await requireAdmin("author");
  const input = DraftSchema.parse({
    domain: formData.get("domain"),
    title: formData.get("title"),
    sourceRef: formData.get("sourceRef"),
    sourceUrl: formData.get("sourceUrl"),
    bodyMd: formData.get("bodyMd"),
    sourceId: formData.get("sourceId"),
    sourceExcerpt: formData.get("sourceExcerpt"),
    sourceRetrievedAt: formData.get("sourceRetrievedAt"),
  });
  await createDraft(input, actor.id);
  revalidatePath("/[locale]/admin", "page");
}

export async function updateDraftAction(formData: FormData) {
  const actor = await requireAdmin("author");
  const input = DraftSchema.parse({
    domain: formData.get("domain"),
    title: formData.get("title"),
    sourceRef: formData.get("sourceRef"),
    sourceUrl: formData.get("sourceUrl"),
    bodyMd: formData.get("bodyMd"),
    sourceId: formData.get("sourceId"),
    sourceExcerpt: formData.get("sourceExcerpt"),
    sourceRetrievedAt: formData.get("sourceRetrievedAt"),
  });
  await updateDraft(
    IdSchema.parse(formData.get("id")),
    input,
    VersionSchema.parse(formData.get("version")),
    actor.id,
  );
  revalidatePath("/[locale]/admin", "page");
}

export async function publishAction(formData: FormData) {
  const actor = await requireAdmin("reviewer");
  await publishContent(
    IdSchema.parse(formData.get("id")),
    VersionSchema.parse(formData.get("version")),
    actor.id,
  );
  revalidatePath("/[locale]/admin", "page");
}

export async function reviewAction(formData: FormData) {
  const actor = await requireAdmin("author");
  await submitForReview(IdSchema.parse(formData.get("id")), actor.id);
  revalidatePath("/[locale]/admin", "page");
}

export async function requestChangesAction(formData: FormData) {
  const actor = await requireAdmin("reviewer");
  await requestContentChanges(
    IdSchema.parse(formData.get("id")),
    VersionSchema.parse(formData.get("version")),
    ReviewNoteSchema.parse(formData.get("note")),
    actor.id,
  );
  revalidatePath("/[locale]/admin", "page");
}

export async function confirmReferralAction(formData: FormData) {
  const actor = await requireAdmin("reviewer");
  await confirmReferral(
    HandoffCodeSchema.parse(formData.get("code")),
    actor.id,
  );
  revalidatePath("/[locale]/admin/referrals", "page");
}

export async function archiveAction(formData: FormData) {
  const actor = await requireAdmin("reviewer");
  await archiveContent(IdSchema.parse(formData.get("id")), actor.id);
  revalidatePath("/[locale]/admin", "page");
}
