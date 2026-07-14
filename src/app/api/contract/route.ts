import type { NextRequest } from "next/server";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { analyzeContract, isSupportedImageType } from "@/lib/contract/analyze";
import { rateLimit, clientKey } from "@/lib/ratelimit";
import { track } from "@/lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * POST /api/contract — multipart form with `file` (image) + `locale`.
 * Returns a ContractAnalysis JSON. The image is analysed in memory and never
 * written to disk or the database.
 */
export async function POST(req: NextRequest) {
  // Contracts are expensive (vision) — tighter limit than chat.
  const rl = rateLimit(`contract:${clientKey(req.headers)}`, {
    limit: 5,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return Response.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "retry-after": String(
            Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  const localeRaw = form.get("locale");
  const locale = hasLocale(routing.locales, localeRaw)
    ? localeRaw
    : routing.defaultLocale;

  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }
  if (!isSupportedImageType(file.type)) {
    return Response.json({ error: "Unsupported file type" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "File too large" }, { status: 413 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  try {
    const analysis = await analyzeContract({
      base64,
      mediaType: file.type,
      locale,
    });
    track({ type: "contract_explained", locale });
    // base64 + file bytes go out of scope here; nothing is persisted.
    return Response.json(analysis);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
