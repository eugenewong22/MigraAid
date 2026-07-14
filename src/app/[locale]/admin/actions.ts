"use server";

import { revalidatePath } from "next/cache";
import { publishContent, submitForReview } from "@/lib/content/cms";

export async function publishAction(formData: FormData) {
  await publishContent(String(formData.get("id")), "admin");
  revalidatePath("/[locale]/admin", "page");
}

export async function reviewAction(formData: FormData) {
  await submitForReview(String(formData.get("id")), "admin");
  revalidatePath("/[locale]/admin", "page");
}
