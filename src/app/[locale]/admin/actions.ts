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

const DraftSchema = z.object({
  domain: z.enum(["legal_rights", "healthcare", "housing", "financial", "settlement"]),
  title: z.string().trim().min(3).max(200),
  sourceRef: z.string().trim().min(3).max(500),
  sourceUrl: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
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
