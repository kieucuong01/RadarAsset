import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    metricObservation: { findMany: vi.fn() },
    dailyBriefing: { findFirst: vi.fn(), groupBy: vi.fn() },
    evidenceItem: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import {
  loadBriefingDateCatalog,
  loadBriefingEnvelope,
  loadMetrics,
  parseInsightWindow,
  smartInsightsToday,
  SmartInsightsInputError,
} from "./smart-insights";

describe("Smart Insights read bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.metricObservation.findMany.mockResolvedValue([]);
    prisma.dailyBriefing.findFirst.mockResolvedValue(null);
    prisma.dailyBriefing.groupBy.mockResolvedValue([]);
    prisma.evidenceItem.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
    vi.stubEnv("SMART_INSIGHTS_TIMEZONE", "Asia/Bangkok");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns Bangkok today and the newest tenant-member briefing dates", async () => {
    prisma.dailyBriefing.groupBy.mockResolvedValue([
      { effectiveDate: new Date("2026-08-16T00:00:00.000Z") },
      { effectiveDate: new Date("2026-08-15T00:00:00.000Z") },
    ]);

    await expect(
      loadBriefingDateCatalog(
        { organizationId: "org-a", userId: "user-a", role: "viewer" } as never,
        new Date("2026-08-16T18:30:00.000Z"),
      ),
    ).resolves.toEqual({
      today: "2026-08-17",
      dates: ["2026-08-16", "2026-08-15"],
    });
    expect(smartInsightsToday(new Date("2026-08-16T18:30:00.000Z"))).toBe("2026-08-17");
    expect(prisma.dailyBriefing.groupBy).toHaveBeenCalledWith({
      by: ["effectiveDate"],
      where: { organizationId: "org-a", userId: "user-a" },
      orderBy: { effectiveDate: "desc" },
      take: 90,
    });
  });

  it("deduplicates and caps the catalog at 90 dates", async () => {
    const rows = Array.from({ length: 91 }, (_, index) => {
      const effectiveDate = new Date("2026-08-17T00:00:00.000Z");
      effectiveDate.setUTCDate(effectiveDate.getUTCDate() - index);
      return { effectiveDate };
    });
    prisma.dailyBriefing.groupBy.mockResolvedValue([rows[0], ...rows]);

    const result = await loadBriefingDateCatalog({
      organizationId: "org-a",
      userId: "user-a",
      role: "viewer",
    } as never);

    expect(result.dates).toHaveLength(90);
    expect(new Set(result.dates).size).toBe(90);
  });

  it.each(["2026-8-01", "2026-02-30", "17-08-2026", "2026-08-17T00:00:00Z"])(
    "rejects malformed or impossible exact date %s before querying",
    async (value) => {
      await expect(
        loadBriefingEnvelope(
          { organizationId: "org-a", userId: "user-a", role: "viewer" } as never,
          value,
        ),
      ).rejects.toBeInstanceOf(SmartInsightsInputError);
      expect(prisma.dailyBriefing.findFirst).not.toHaveBeenCalled();
    },
  );

  it("loads 25 embedded asset opinions with one tenant-scoped briefing query", async () => {
    const storedOpinion = {
      symbol: "BTC",
      assetName: "Bitcoin",
      stance: "CONSTRUCTIVE",
      quantScore: "61.25",
      confidence: "76",
      horizon: "WEEKS_1_4",
      portfolioWeightPct: "18",
      unrealizedReturn: "0.12",
      riskTolerance: "moderate",
      personalizedAction: "HOLD",
      formula: "asset_score = Σ(pillar_score × pillar_weight) ÷ data_coverage",
      totalContribution: "49",
      quantInvalidationConditions: ["ASSET_SCORE_BELOW_15"],
      supportingEvidenceIds: ["e-support"],
      contradictingEvidenceIds: [],
      decisionInputs: [
        {
          evidenceId: "e-support",
          metricCode: "crypto.etf.net_flow_usd",
          pillarCode: "fund_flow",
          rawValue: "120",
          unit: "USD_MILLION",
          normalizedScore: "70",
          inputWeight: "0.75",
          weightedScore: "52.5",
          pillarWeight: "0.3",
          contribution: "15.75",
          normalizationMethod: "empirical_percentile",
          percentile: "0.85",
          lookback: "90D",
        },
      ],
      pillars: [
        {
          code: "trend",
          score: "70",
          weight: "0.35",
          confidence: "80",
          availableInputWeight: "1",
          contribution: "24.5",
          factIds: ["fact-a"],
          series: [{ ts: "2026-08-14T00:00:00+00:00", value: 65 }],
        },
      ],
      thesis: "BTC duy tri xu huong tich cuc.",
      bullCase: "Dong tien ETF tiep tuc duong.",
      baseCase: "Kich ban co so duoc dong tien ho tro.",
      bearCase: "Dong tien ETF dao chieu.",
      invalidationConditions: ["Gia mat MA50."],
      evidence: [
        {
          id: "e-support",
          metricCode: "crypto.etf.net_flow_usd",
          displayValue: "$120.00m",
          delta: null,
          percentile: null,
          impact: "supporting",
          sourceCode: "farside",
          sourceUrl: "https://farside.co.uk",
          effectiveAt: "2026-08-14T00:00:00+00:00",
          observedAt: "2026-08-15T00:00:00+00:00",
          freshness: "fresh",
          usedInDecision: true,
        },
      ],
      dataCoverage: "0.8",
      freshness: "fresh",
      explanationStatus: "accepted",
      failedGates: [],
    };
    const currentBriefing = {
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
      marketSummary: { assetOpinions: Array.from({ length: 25 }, () => storedOpinion) },
      items: [],
    };
    prisma.dailyBriefing.findFirst.mockResolvedValueOnce(currentBriefing).mockResolvedValueOnce({
      marketSummary: {
        assetOpinions: [{ ...storedOpinion, stance: "NEUTRAL", quantScore: "40" }],
      },
    });
    prisma.$queryRaw.mockResolvedValue([
      {
        symbol: "BTC",
        horizonSessions: 5,
        sampleSize: 24,
        hitRate: { toString: () => "0.625" },
        averageReturn: { toString: () => "0.031" },
        averageExcessReturn: { toString: () => "0.012" },
      },
    ]);

    const result = await loadBriefingEnvelope(
      { organizationId: "org-a", userId: "user-a", role: "viewer" } as never,
      null,
    );

    expect(result?.fingerprint).toBe("fingerprint-a");
    expect(result?.briefing.assetOpinions).toHaveLength(25);
    expect(result?.briefing.assetOpinions[0]).toEqual(
      expect.objectContaining({
        symbol: "BTC",
        assetName: "Bitcoin",
        stance: "CONSTRUCTIVE",
        quantScore: "61.25",
        personalizedAction: "HOLD",
        explanationStatus: "accepted",
        bullCase: "Dong tien ETF tiep tuc duong.",
        bearCase: "Dong tien ETF dao chieu.",
        invalidationConditions: ["Gia mat MA50."],
        evidence: [
          expect.objectContaining({ id: "e-support", impact: "supporting", freshness: "fresh" }),
        ],
        decisionInputs: [
          expect.objectContaining({
            evidenceId: "e-support",
            normalizedScore: "70",
            contribution: "15.75",
          }),
        ],
        supportingEvidenceIds: ["e-support"],
        performance: {
          status: "available",
          horizons: [
            {
              horizonSessions: 5,
              sampleSize: 24,
              hitRate: "0.625",
              averageReturn: "0.031",
              averageExcessReturn: "0.012",
            },
          ],
        },
      }),
    );
    expect(result?.briefing.portfolioChanges).toEqual([
      expect.objectContaining({
        symbol: "BTC",
        previousStance: "NEUTRAL",
        currentStance: "CONSTRUCTIVE",
        changeType: "stance_action",
      }),
    ]);
    expect(result?.briefing.portfolioChangesStatus).toBe("ready");
    expect(prisma.dailyBriefing.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.evidenceItem.findMany).not.toHaveBeenCalled();
  });

  it("fails only a quant-only asset carrying stale AI prose", async () => {
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
      marketSummary: {
        assetOpinions: [
          {
            symbol: "XAU",
            assetName: "Gold",
            stance: "NEUTRAL",
            quantScore: "0",
            confidence: "50",
            horizon: "WEEKS_1_4",
            portfolioWeightPct: "0",
            unrealizedReturn: null,
            riskTolerance: "moderate",
            personalizedAction: "HOLD",
            formula: "asset_score = Σ(pillar_score × pillar_weight) ÷ data_coverage",
            totalContribution: "0",
            quantInvalidationConditions: ["ASSET_SCORE_OUTSIDE_NEGATIVE_15_TO_15"],
            decisionInputs: [],
            supportingEvidenceIds: [],
            contradictingEvidenceIds: [],
            pillars: [],
            thesis: "Stale AI prose",
            bullCase: null,
            baseCase: null,
            bearCase: null,
            invalidationConditions: [],
            evidence: [],
            dataCoverage: "0.8",
            freshness: "fresh",
            explanationStatus: "quant_only",
            failedGates: [],
          },
        ],
      },
      items: [],
    });

    const result = await loadBriefingEnvelope({
      organizationId: "org-a",
      userId: "user-a",
      role: "viewer",
    } as never);

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
