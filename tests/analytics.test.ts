import { afterEach, describe, expect, it, vi } from "vitest";
import { track } from "@/lib/analytics";
import { kpisFromMetricRows } from "@/lib/analytics/kpi";
import { IMPACT_METRICS, metricDay } from "@/lib/analytics/metrics";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("track", () => {
  it("does nothing unless both the project key and host are configured", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.POSTHOG_HOST;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await track({ type: "message_sent", locale: "en", escalated: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends allow-listed properties with an unlinkable per-event id", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    process.env.POSTHOG_HOST = "https://analytics.example.org";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await track(
      { type: "message_sent", locale: "bn", escalated: true },
      { sessionId: "raw-worker-session" },
    );
    await track(
      { type: "message_sent", locale: "bn", escalated: true },
      { sessionId: "raw-worker-session" },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    expect(body).not.toContain("raw-worker-session");
    expect(JSON.parse(body)).toMatchObject({
      event: "message_sent",
      properties: {
        locale: "bn",
        escalated: true,
        $process_person_profile: false,
      },
    });
    const first = JSON.parse(body).properties.distinct_id;
    const second = JSON.parse(
      String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body),
    ).properties.distinct_id;
    expect(first).not.toBe(second);
  });
});

describe("privacy-safe KPI rollups", () => {
  it("reports satisfaction as the share of ratings at least four", () => {
    const kpis = kpisFromMetricRows([
      { metric: IMPACT_METRICS.feedbackCount, value: 3 },
      { metric: IMPACT_METRICS.feedbackSatisfied, value: 2 },
      { metric: IMPACT_METRICS.feedbackRatingSum, value: 10 },
      { metric: IMPACT_METRICS.contractsExplained, value: 7 },
    ]);

    expect(kpis.satisfactionRate).toBeCloseTo(2 / 3);
    expect(kpis.avgSatisfaction).toBeCloseTo(10 / 3);
    expect(kpis.contractsExplained).toBe(7);
  });

  it("uses stable UTC daily buckets", () => {
    expect(metricDay(new Date("2026-07-14T23:59:59.000-07:00"))).toBe(
      "2026-07-15",
    );
  });
});
