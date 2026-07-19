import type { NextRequest } from "next/server";
import { reportError } from "@/lib/observability/sentry";
import { hasValidCronAuthorization } from "@/lib/privacy/cron";
import { deleteExpiredWorkerData } from "@/lib/privacy/retention";

export const runtime = "nodejs";
export const maxDuration = 60;

async function cleanup(req: NextRequest) {
  if (
    !hasValidCronAuthorization(
      req.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await deleteExpiredWorkerData();
    if (!result.complete) {
      // Vercel Cron ignores response bodies, so an exhausted batch budget is
      // invisible unless reported: sustained expiry volume above the per-run
      // cap would otherwise silently retain worker data past the promised
      // 30 days, indefinitely.
      await reportError(
        new Error("Retention sweep incomplete: batch budget exhausted"),
        "cron.privacy-cleanup",
      );
    }
    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    await reportError(error, "cron.privacy-cleanup");
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  }
}

/** Vercel Cron invokes GET; POST is also available to an external scheduler. */
export const GET = cleanup;
export const POST = cleanup;
