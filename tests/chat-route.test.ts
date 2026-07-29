/**
 * The /api/chat request contract, end to end through the real route handler.
 *
 * Every Playwright test stubs this route wholesale (`page.route("**\/api/chat")`),
 * so until now the handler itself had no coverage at all: the NDJSON frame
 * sequence, the ops gating, escalation routing, the session cookie and the new
 * status/progress frames were only ever exercised by hand.
 *
 * What is mocked, and why:
 *   - `streamAnswer` and `retrieve`, so a test does not need a provider or a
 *     pgvector database. The citation gate inside `enforceAnswerSafety` has its
 *     own 500-line suite in answer.test.ts; what is untested is the *route*.
 *   - `getDb`, which throws. That is a real production path — the route treats
 *     persistence as best-effort — and it keeps these tests free of a database.
 *   - the ops gate, so degraded mode and rate limiting can be driven directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { RagAnswer, RetrievedChunk } from "@/lib/rag/types";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    guard: vi.fn(),
    retrieve: vi.fn(),
    streamAnswer: vi.fn(),
    preflight: vi.fn(),
  },
}));

vi.mock("@/lib/ops/guard", () => ({ guardGenerativeRoute: mocks.guard }));
vi.mock("@/lib/ops/gate", () => ({
  acquireInflight: async () => async () => {},
  addSpend: async () => {},
}));
vi.mock("@/lib/rag/retrieve", () => ({
  retrieve: mocks.retrieve,
  normalizeQueryForRetrieval: async (text: string) => text,
}));
vi.mock("@/lib/rag/answer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rag/answer")>();
  return {
    ...actual,
    streamAnswer: mocks.streamAnswer,
    preflightSafetyAnswer: (query: string, locale: string) =>
      mocks.preflight(query, locale) ?? actual.preflightSafetyAnswer(query, locale),
  };
});
// No database in these tests. The route already treats persistence as
// best-effort, so this exercises a path production genuinely takes.
vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("no database in this test");
  },
}));
vi.mock("@/lib/analytics", () => ({ track: async () => {} }));
vi.mock("@/lib/privacy/tombstone", () => ({
  isSessionTombstoned: async () => false,
  tombstoneSession: async () => {},
}));

const { POST } = await import("@/app/api/chat/route");

const CHUNK: RetrievedChunk = {
  chunkId: "c1",
  contentItemId: "i1",
  sourceRef: "MOM — Paying salary",
  sourceUrl: "https://www.mom.gov.sg/employment-practices/salary/paying-salary",
  domain: "legal_rights",
  text: "Your employer must pay your salary within 7 days.",
  score: 0.72,
};

function answerOf(overrides: Partial<RagAnswer> = {}): RagAnswer {
  return {
    text: "Your salary must be paid within 7 days. [1]",
    citations: [
      {
        sourceRef: CHUNK.sourceRef,
        sourceUrl: CHUNK.sourceUrl ?? undefined,
        contentItemId: CHUNK.contentItemId,
        sourceNumber: 1,
      },
    ],
    escalated: false,
    model: "test-model",
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    ...overrides,
  };
}

/** A generation that yields `deltas` then resolves to `final`. */
function generation(final: RagAnswer, deltas: string[] = ["Your ", "salary…"]) {
  return {
    textStream: (async function* () {
      for (const delta of deltas) yield delta;
    })(),
    final: async () => final,
  };
}

function request(
  body: unknown = { message: "When must my salary be paid?", locale: "en" },
  extraHeaders: Record<string, string> = {},
): NextRequest {
  return new NextRequest("https://migraaid.sg/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://migraaid.sg",
      host: "migraaid.sg",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

/** Read the whole NDJSON body into parsed frames. */
async function frames(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  mocks.guard.mockResolvedValue({ gate: { flags: {} }, clientIp: "1.2.3.4" });
  mocks.retrieve.mockResolvedValue([CHUNK]);
  mocks.streamAnswer.mockReturnValue(generation(answerOf()));
  mocks.preflight.mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/chat — request gating", () => {
  it("refuses a cross-origin request before doing any work", async () => {
    const response = await POST(
      request({ message: "hi", locale: "en" }, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
    expect(mocks.guard).not.toHaveBeenCalled();
  });

  it("returns whatever the ops guard decided, without generating", async () => {
    // Degraded mode, budget ceiling, kill switch and rate limiting all arrive
    // through this one path.
    mocks.guard.mockResolvedValue({
      response: Response.json({ error: "unavailable" }, { status: 503 }),
      gate: { flags: {} },
      clientIp: "1.2.3.4",
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.streamAnswer).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty message", { message: "   ", locale: "en" }, 400],
    ["an over-long message", { message: "x".repeat(2001), locale: "en" }, 413],
  ])("rejects %s", async (_label, body, status) => {
    expect((await POST(request(body))).status).toBe(status);
  });
});

describe("POST /api/chat — the NDJSON contract", () => {
  it("reports each stage, then delivers one atomic done frame", async () => {
    const response = await POST(request());
    const received = await frames(response);

    expect(response.headers.get("content-type")).toContain("application/x-ndjson");

    const stages = received
      .filter((f) => f.type === "status")
      .map((f) => f.stage);
    expect(stages).toEqual(["searching", "reading", "writing", "checking"]);

    // Exactly one terminal frame, and it is last.
    const done = received.filter((f) => f.type === "done");
    expect(done).toHaveLength(1);
    expect(received[received.length - 1].type).toBe("done");
  });

  it("never leaks answer text before the done frame", async () => {
    // The whole reason the route buffers: no token may reach the browser until
    // the citation gate has passed.
    const received = await frames(await POST(request()));
    for (const frame of received) {
      if (frame.type === "done") continue;
      expect(JSON.stringify(frame)).not.toContain("7 days");
    }
  });

  it("reports how much has been written without revealing any of it", async () => {
    mocks.streamAnswer.mockReturnValue(
      generation(answerOf(), Array.from({ length: 40 }, () => "some text ")),
    );
    const received = await frames(await POST(request()));
    const progress = received.filter((f) => f.type === "progress");

    // Non-vacuous: the 500ms throttle must not swallow every frame.
    expect(progress.length).toBeGreaterThan(0);
    for (const frame of progress) {
      expect(typeof frame.chars).toBe("number");
      expect(Object.keys(frame).sort()).toEqual(["chars", "type"]);
    }
  });

  it("carries citations and the source count through to the client", async () => {
    const received = await frames(await POST(request()));
    const done = received.find((f) => f.type === "done")!;
    const reading = received.find((f) => f.stage === "reading")!;

    expect(reading.sourceCount).toBe(1);
    expect(done.citations).toHaveLength(1);
    expect(done.text).toContain("7 days");
  });
});

describe("POST /api/chat — escalation", () => {
  it("attaches referrals and a severity when a serious issue is detected", async () => {
    mocks.streamAnswer.mockReturnValue(
      generation(answerOf({ escalated: true, issueType: "unpaid_salary" })),
    );
    const done = (await frames(await POST(request()))).find((f) => f.type === "done")!;

    expect(done.escalated).toBe(true);
    expect(done.severity).toBe("assisted");
    expect(Array.isArray(done.referrals)).toBe(true);
    expect((done.referrals as unknown[]).length).toBeGreaterThan(0);
  });

  it("keeps the grounded answer for an assisted escalation", async () => {
    // The point of the two-tier split: a worker asking about unpaid salary gets
    // the rule *and* the referral, not only a phone number.
    mocks.streamAnswer.mockReturnValue(
      generation(answerOf({ escalated: true, issueType: "unpaid_salary" })),
    );
    const done = (await frames(await POST(request()))).find((f) => f.type === "done")!;
    expect(done.text).toContain("7 days");
    expect(done.citations).toHaveLength(1);
  });

  it("short-circuits a danger case before retrieval or generation", async () => {
    const { preflightSafetyAnswer } = await vi.importActual<
      typeof import("@/lib/rag/answer")
    >("@/lib/rag/answer");
    mocks.preflight.mockImplementation((q: string, l: string) =>
      preflightSafetyAnswer(q, l),
    );

    const response = await POST(
      request({ message: "My employer took my passport", locale: "en" }),
    );
    const done = (await frames(response)).find((f) => f.type === "done")!;

    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.streamAnswer).not.toHaveBeenCalled();
    expect(done.escalated).toBe(true);
  });
});

describe("POST /api/chat — session cookie", () => {
  it("mints an opaque session id that expires with the data it scopes", async () => {
    const response = await POST(request());
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(cookie).toMatch(/^maid_sid=[0-9a-f-]{36};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    // 30 days, not the year it used to be.
    expect(cookie).toContain("Max-Age=2592000");
  });

  it("does not re-mint one when the caller already has a valid cookie", async () => {
    const response = await POST(
      request(
        { message: "hello", locale: "en" },
        { cookie: "maid_sid=3f7a1b2c-4d5e-4f60-8a91-2b3c4d5e6f70" },
      ),
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
