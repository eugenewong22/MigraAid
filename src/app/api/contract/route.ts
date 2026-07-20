import type { NextRequest } from "next/server";
import { after } from "next/server";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import {
  analyzeContract,
  hasMatchingImageSignature,
  isSupportedImageType,
} from "@/lib/contract/analyze";
import { hasExplicitStorageConsent } from "@/lib/contract/privacy";
import {
  rateLimit,
  clientKey,
  reportUntrustedClientKey,
  UNTRUSTED_CLIENT_KEY,
} from "@/lib/ratelimit";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { contractReviews } from "@/lib/db/schema";
import { randomUUID } from "node:crypto";
import { isSessionTombstoned } from "@/lib/privacy/tombstone";
import { deleteWorkerSessionData } from "@/lib/privacy/delete";
import { scrubPii } from "@/lib/safety/pii";
import { reportError } from "@/lib/observability/sentry";
import {
  readBoundedBytes,
  RequestBodyTooLargeError,
} from "@/lib/http/body";
import { isSameOriginRequest } from "@/lib/http/origin";
import { ContractAnalysisError } from "@/lib/contract/analyze";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
// Allow room for multipart boundaries and the locale/consent fields while
// rejecting an oversized request before Next parses it into memory.
const MAX_REQUEST_BYTES = MAX_BYTES + 1024 * 1024;

/**
 * POST /api/contract — multipart form with `file` (image), `locale`, and an
 * optional `saveAnalysis=true` storage opt-in.
 * Returns a ContractAnalysis JSON. The image is analysed in memory and never
 * written to disk or the database.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return Response.json(
      { error: "Cross-origin upload rejected" },
      { status: 403 },
    );
  }

  // Contracts are expensive (vision) — tighter limit than chat.
  const clientIp = clientKey(req.headers);
  if (clientIp === UNTRUSTED_CLIENT_KEY) reportUntrustedClientKey("api.contract");
  const rl = await rateLimit(`contract:${clientIp}`, {
    limit: 5,
    windowMs: 60_000,
  });
  if (process.env.NODE_ENV === "production" && rl.source === "memory") {
    await reportError(
      new Error("Distributed rate limiter unavailable for contract analysis"),
      "api.contract.ratelimit",
    );
    return Response.json(
      { error: "Contract analysis is temporarily unavailable" },
      { status: 503, headers: { "retry-after": "60" } },
    );
  }
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

  const contentType = req.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    return Response.json({ error: "Multipart form data is required" }, { status: 415 });
  }

  const existingSid = req.cookies.get("maid_sid")?.value;
  const sid = existingSid ?? randomUUID();

  let form: FormData;
  try {
    const requestBytes = await readBoundedBytes(req, MAX_REQUEST_BYTES);
    const boundedRequest = new Request(req.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: requestBytes.buffer as ArrayBuffer,
    });
    form = await boundedRequest.formData();
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "File too large" }, { status: 413 });
    }
    return Response.json({ error: "Invalid multipart form data" }, { status: 400 });
  }
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

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return Response.json({ error: "Could not read file" }, { status: 400 });
  }
  if (!hasMatchingImageSignature(bytes, file.type)) {
    return Response.json(
      { error: "File contents do not match the declared image type" },
      { status: 400 },
    );
  }

  const base64 = Buffer.from(bytes).toString("base64");
  const saveAnalysis = hasExplicitStorageConsent(form.get("saveAnalysis"));

  try {
    const analysis = await analyzeContract({
      base64,
      mediaType: file.type,
      locale,
    });
    // Analytics run after the response is flushed — never between the finished
    // analysis and the worker seeing it. `track` swallows its own failures.
    after(() => track({ type: "contract_explained", locale }, { sessionId: sid }));

    // Persist derived analysis only after an explicit opt-in. The image and its
    // raw text are never stored, even when the worker opts in.
    let saved: boolean | null = null;
    // A "delete my data" request may have committed during the (up to 60s)
    // vision analysis. Don't resurrect a contract_reviews row (employment
    // summary, salary/employer terms) under a session id whose cookie the
    // deletion already expired — the same race the chat route guards against.
    if (saveAnalysis && !(await isSessionTombstoned(sid))) {
      try {
        await getDb().insert(contractReviews).values({
          anonSessionId: sid,
          lang: locale,
          summary: scrubPii(analysis.summary),
          keyTerms: analysis.keyTerms.map((term) => ({
            label: scrubPii(term.label),
            value: scrubPii(term.value),
          })),
          // Persist concern + severity only; the verbatim clause quote is
          // extracted contract text and is never stored.
          flaggedClauses: analysis.flaggedClauses.map((clause) => ({
            concern: scrubPii(clause.concern),
            severity: clause.severity,
          })),
        });
        // Re-check after commit: the delete may have landed during the insert.
        if (await isSessionTombstoned(sid)) {
          await deleteWorkerSessionData(sid);
          saved = false;
        } else {
          saved = true;
        }
      } catch (persistenceError) {
        saved = false;
        if (process.env.DATABASE_URL) {
          await reportError(persistenceError, "api.contract.persistence");
        }
      }
    } else if (saveAnalysis) {
      // Consent given, but the session was already erased — nothing stored.
      saved = false;
    }

    // Extracted contract terms are sensitive personal data — match the chat
    // route's explicit no-store rather than relying on POST-caching defaults.
    const headers: Record<string, string> = { "cache-control": "no-store" };
    // Only plant a durable session cookie when an analysis was actually saved
    // (so it can later be deleted). Gate on `saved`, not merely the consent
    // flag: a failed or tombstone-skipped save leaves nothing to reference, so
    // it must not leave a durable identifier behind either.
    if (!existingSid && saved === true) {
      headers["set-cookie"] =
        `maid_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${
          process.env.NODE_ENV === "production" ? "; Secure" : ""
        }`;
    }
    // The image base64 goes out of scope here; only the analysis is stored.
    return Response.json({ ...analysis, saved }, { headers });
  } catch (err) {
    if (err instanceof ContractAnalysisError) {
      return Response.json(
        { error: err.message, code: err.code },
        { status: 422 },
      );
    }
    await reportError(err, "api.contract");
    return Response.json({ error: "Could not analyse the contract." }, { status: 500 });
  }
}
