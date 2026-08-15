import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    metricObservation: { findMany: vi.fn() },
    dailyBriefing: { findFirst: vi.fn() },
    evidenceItem: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import {
  loadBriefingEnvelope,
  loadMetrics,
  parseInsightWindow,
  SmartInsightsInputError,
} from "./smart-insights";

describe("Smart Insights read bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.metricObservation.findMany.mockResolvedValue([]);
    prisma.dailyBriefing.findFirst.mockResolvedValue(null);
    prisma.evidenceItem.findMany.mockResolvedValue([]);
  });

  it("loads asset opinions and their evidence with a constant two-query read", async () => {
    prisma.dailyBriefing.findFirst.mockResolvedValue({
      id: "briefing-a",
      effectiveDate: new Date("2026-08-15T00:00:00Z"),
      revision: 1,
      effectiveAt: new Date("2026-08-15T01:00:00Z"),
      timezone: "Asia/Bangkok",
      status: "quant_only",
      dataConfidence: { toString: () => "72.5" },
      portfolioSnapshot: { portfolioState: "available" },
      researchRunId: "run-a",
      fingerprint: "fingerprint-a",
      items: [
        {
          id: "item-btc",
          signalSnapshotId: "signal-btc",
          section: "asset_opinion",
          relevanceScore: { toString: () => "18" },
          relevanceComponents: {},
          supportingEvidenceIds: ["e-support"],
          contradictingEvidenceIds: ["e-risk"],
          affectedAssets: ["BTC"],
          timeHorizon: "WEEKS_1_4",
          riskScenarios: [],
          suggestedCheckTemplate: "HOLD_REVIEW_RISK",
          explanationStatus: "accepted",
          confidence: { toString: () => "76" },
          outcomes: {},
          signalSnapshot: {
            market: "crypto",
            signalType: "asset_opinion",
            score: { toString: () => "61.25" },
            label: "CONSTRUCTIVE",
            inputs: {
              assetName: "Bitcoin",
              portfolioWeightPct: "18",
              freshness: "fresh",
              gate: { failed_gates: [] },
              pillars: [
                {
                  code: "trend",
                  score: "70",
                  configured_weight: "0.35",
                  confidence: "80",
                  fact_ids: ["fact-a"],
                  series: [["2026-08-14T00:00:00+00:00", "65"]],
                },
              ],
            },
            asset: { symbol: "BTC", name: "Bitcoin" },
          },
          aiInsight: {
            title: "BTC duy tri xu huong tich cuc.",
            summary: "Kich ban co so duoc dong tien ho tro.",
            catalyst: "Dong tien ETF tiep tuc duong.",
            risk: JSON.stringify({
              bearCase: "Dong tien ETF dao chieu.",
              invalidationConditions: ["Gia mat MA50."],
            }),
          },
        },
      ],
    });
    prisma.evidenceItem.findMany.mockResolvedValue([
      {
        id: "e-support",
        excerpt: JSON.stringify({
          metric_code: "crypto.etf.net_flow_usd",
          display_value: "$120.00m",
          source_code: "farside",
          source_url: "https://farside.co.uk",
          effective_end: "2026-08-14T00:00:00+00:00",
          observed_at: "2026-08-15T00:00:00+00:00",
          warnings: [],
        }),
      },
      {
        id: "e-risk",
        excerpt: JSON.stringify({
          metric_code: "crypto.onchain.whale_balance",
          display_value: "-2.10%",
          source_code: "bitinfocharts",
          source_url: "https://bitinfocharts.com",
          effective_end: "2026-08-14T00:00:00+00:00",
          observed_at: "2026-08-15T00:00:00+00:00",
          warnings: ["STALE"],
        }),
      },
    ]);

    const result = await loadBriefingEnvelope(
      { organizationId: "org-a", userId: "user-a", role: "viewer" } as never,
      null,
    );

    expect(result?.fingerprint).toBe("fingerprint-a");
    expect(result?.briefing.assetOpinions).toEqual([
      expect.objectContaining({
        symbol: "BTC",
        assetName: "Bitcoin",
        stance: "CONSTRUCTIVE",
        quantScore: "61.25",
        personalizedAction: "HOLD_REVIEW_RISK",
        explanationStatus: "accepted",
        bullCase: "Dong tien ETF tiep tuc duong.",
        bearCase: "Dong tien ETF dao chieu.",
        invalidationConditions: ["Gia mat MA50."],
        evidence: [
          expect.objectContaining({ id: "e-support", impact: "supporting", freshness: "fresh" }),
          expect.objectContaining({ id: "e-risk", impact: "contradicting", freshness: "stale" }),
        ],
      }),
    ]);
    expect(prisma.dailyBriefing.findFirst).toHaveBeenCalledOnce();
    expect(prisma.evidenceItem.findMany).toHaveBeenCalledOnce();
  });

  it("fails only the malformed asset opinion and preserves the briefing", async () => {
    prisma.dailyBriefing.findFirst.mockResolvedValue({
      id: "briefing-b",
      effectiveDate: new Date("2026-08-15T00:00:00Z"),
      revision: 1,
      effectiveAt: new Date("2026-08-15T01:00:00Z"),
      timezone: "Asia/Bangkok",
      status: "quant_only",
      dataConfidence: { toString: () => "0" },
      portfolioSnapshot: {},
      researchRunId: "run-b",
      fingerprint: "fingerprint-b",
      items: [
        {
          id: "item-bad",
          signalSnapshotId: "signal-bad",
          section: "asset_opinion",
          relevanceScore: { toString: () => "0" },
          relevanceComponents: {},
          supportingEvidenceIds: [],
          contradictingEvidenceIds: [],
          affectedAssets: ["XAU"],
          timeHorizon: "WEEKS_1_4",
          riskScenarios: [],
          suggestedCheckTemplate: "NO_ACTION_INSUFFICIENT_DATA",
          explanationStatus: "accepted",
          confidence: { toString: () => "0" },
          outcomes: {},
          signalSnapshot: {
            market: "gold",
            signalType: "asset_opinion",
            score: null,
            label: "INSUFFICIENT_DATA",
            inputs: { pillars: "malformed" },
            asset: { symbol: "XAU", name: "Gold" },
          },
          aiInsight: null,
        },
      ],
    });

    const result = await loadBriefingEnvelope(
      { organizationId: "org-a", userId: "user-a", role: "viewer" } as never,
    );

    expect(result?.briefing.assetOpinions).toEqual([
      expect.objectContaining({
        symbol: "XAU",
        explanationStatus: "unavailable",
        failedGates: ["STORED_CONTRACT_INVALID"],
      }),
    ]);
  });

  it("accepts a 31-day inclusive metric window", () => {
    const result = parseInsightWindow(new URL("http://local?from=2026-08-01&to=2026-09-01"));
    expect(result.from.toISOString()).toContain("2026-08-01");
  });

  it("rejects windows beyond 31 days", () => {
    expect(() => parseInsightWindow(new URL("http://local?from=2026-01-01&to=2026-03-01"))).toThrow(
      SmartInsightsInputError,
    );
  });

  it("keeps enough rows for all daily Crypto series in the 31-day window", async () => {
    await loadMetrics({
      market: "crypto",
      from: new Date("2026-07-14T00:00:00Z"),
      to: new Date("2026-08-14T00:00:00Z"),
    });

    expect(prisma.metricObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5_000 }),
    );
  });

  it("returns only the newest immutable revision for each natural key", async () => {
    const base = {
      naturalKey: "crypto:onchain:nvt:BTC:2026-08-14",
      effectiveAt: new Date("2026-08-14T00:00:00Z"),
      effectiveStart: new Date("2026-08-14T00:00:00Z"),
      effectiveEnd: new Date("2026-08-14T00:00:00Z"),
      observedAt: new Date("2026-08-14T01:00:00Z"),
      qualityStatus: "passed",
      qualityFlags: [],
      metricDefinition: {
        code: "crypto.onchain.nvt",
        market: "crypto",
        unit: "ratio",
        freshnessSlaMinutes: 2_880,
        methodologyVersion: "v1",
      },
      provider: { code: "coinmetrics-community" },
      asset: { symbol: "BTC" },
      rawSnapshot: { sourceUrl: "https://example.test/coinmetrics" },
    };
    prisma.metricObservation.findMany.mockResolvedValue([
      { ...base, id: "revision-2", revision: 2, value: { toString: () => "20" } },
      { ...base, id: "revision-1", revision: 1, value: { toString: () => "18" } },
    ]);

    const result = await loadMetrics({
      market: "crypto",
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-08-14T00:00:00Z"),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ observationId: "revision-2", value: "20" });
  });
});
