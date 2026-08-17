import { afterEach, describe, expect, it, vi } from "vitest";

import { briefingSchema, fetchBriefing, fetchBriefingDates } from "./smart-insights-client";

const base = {
  id: "briefing-a",
  localDate: "2026-08-15",
  revision: 1,
  generatedAt: "2026-08-15T01:00:00.000Z",
  timezone: "Asia/Bangkok",
  status: "quant_only" as const,
  overallDataConfidence: "75",
  portfolioState: "available" as const,
  primary: [],
  riskAlerts: [],
  sourceRunId: "run-a",
};

const calculation = {
  formula: "asset_score = Σ(pillar_score × pillar_weight) ÷ data_coverage",
  totalContribution: "49",
  quantInvalidationConditions: ["ASSET_SCORE_BELOW_15"],
  decisionInputs: [
    {
      evidenceId: "e-a",
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
  supportingEvidenceIds: ["e-a"],
  contradictingEvidenceIds: [],
};

describe("Smart Insights briefing contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a quantified asset opinion with chart series and evidence", () => {
    const result = briefingSchema.parse({
      ...base,
      assetOpinions: [
        {
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
          ...calculation,
          pillars: [
            {
              code: "trend",
              score: "70",
              weight: "0.35",
              confidence: "80",
              availableInputWeight: "1",
              contribution: "24.5",
              factIds: ["fact-a"],
              series: [{ ts: "2026-08-14T00:00:00Z", value: 65 }],
            },
          ],
          thesis: "Xu huong duoc du lieu xac nhan.",
          bullCase: "Dong tien tiep tuc ho tro.",
          baseCase: "Duy tri vi the voi gioi han rui ro.",
          bearCase: "Dong tien dao chieu.",
          invalidationConditions: ["Gia mat MA50."],
          evidence: [
            {
              id: "e-a",
              metricCode: "crypto.etf.net_flow_usd",
              displayValue: "$120.00m",
              delta: null,
              percentile: null,
              impact: "supporting",
              sourceCode: "farside",
              sourceUrl: "https://farside.co.uk",
              effectiveAt: "2026-08-14T00:00:00Z",
              observedAt: "2026-08-15T00:00:00Z",
              freshness: "fresh",
              usedInDecision: true,
            },
          ],
          dataCoverage: "0.8",
          freshness: "fresh",
          explanationStatus: "accepted",
          failedGates: [],
        },
      ],
    });

    expect(result.assetOpinions[0]?.pillars[0]?.series[0]?.value).toBe(65);
  });

  it("rejects leaked research-run internals", () => {
    expect(() => briefingSchema.parse({ ...base, assetOpinions: [], prompt: "secret" })).toThrow();
  });

  it("rejects unknown actions", () => {
    const opinion = {
      symbol: "BTC",
      assetName: "Bitcoin",
      stance: "CONSTRUCTIVE",
      quantScore: "61.25",
      confidence: "76",
      horizon: "WEEKS_1_4",
      portfolioWeightPct: "18",
      unrealizedReturn: null,
      riskTolerance: "moderate",
      personalizedAction: "BUY_NOW",
      ...calculation,
      decisionInputs: [],
      supportingEvidenceIds: [],
      pillars: [],
      thesis: null,
      bullCase: null,
      baseCase: null,
      bearCase: null,
      invalidationConditions: [],
      evidence: [],
      dataCoverage: "0.8",
      freshness: "fresh",
      explanationStatus: "quant_only",
      failedGates: [],
    };

    expect(() => briefingSchema.parse({ ...base, assetOpinions: [opinion] })).toThrow();
    expect(() =>
      briefingSchema.parse({
        ...base,
        assetOpinions: [{ ...opinion, personalizedAction: "HOLD", thesis: "Stale prose" }],
      }),
    ).toThrow(/Non-accepted opinions cannot contain AI prose/);
  });

  it("rejects accepted opinions with stale data or nested extra fields", () => {
    const parsed = briefingSchema.parse({
      ...base,
      assetOpinions: [
        {
          symbol: "BTC",
          assetName: "Bitcoin",
          stance: "CONSTRUCTIVE",
          quantScore: "61.25",
          confidence: "76",
          horizon: "WEEKS_1_4",
          portfolioWeightPct: "18",
          unrealizedReturn: null,
          riskTolerance: "moderate",
          personalizedAction: "HOLD",
          ...calculation,
          pillars: [],
          thesis: "Thesis",
          bullCase: "Bull",
          baseCase: "Base",
          bearCase: "Bear",
          invalidationConditions: ["Invalidation"],
          evidence: [
            {
              id: "e-a",
              metricCode: "trend.return_20d",
              displayValue: "1%",
              delta: null,
              percentile: null,
              impact: "supporting",
              sourceCode: "market-bars",
              sourceUrl: "https://example.test/source",
              effectiveAt: "2026-08-14T00:00:00Z",
              observedAt: "2026-08-15T00:00:00Z",
              freshness: "fresh",
              usedInDecision: true,
            },
          ],
          dataCoverage: "0.8",
          freshness: "fresh",
          explanationStatus: "accepted",
          failedGates: [],
        },
      ],
    }).assetOpinions[0];

    expect(() =>
      briefingSchema.parse({ ...base, assetOpinions: [{ ...parsed, freshness: "stale" }] }),
    ).toThrow(/Accepted data must be fresh/);
    expect(() =>
      briefingSchema.parse({
        ...base,
        assetOpinions: [{ ...parsed, evidence: [{ ...parsed.evidence[0], unexpected: true }] }],
      }),
    ).toThrow();
  });

  it("treats 202 as generating without parsing it as a briefing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ state: "generating", requestVersion: 2 }), {
          status: 202,
        }),
      ),
    );

    await expect(fetchBriefing("2026-08-17")).resolves.toEqual({
      state: "generating",
      briefing: null,
      errorCode: null,
    });
  });

  it("returns the existing briefing contract as ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...base, assetOpinions: [] }), { status: 200 }),
        ),
    );

    await expect(fetchBriefing("2026-08-15")).resolves.toMatchObject({
      state: "ready",
      briefing: { id: "briefing-a" },
      errorCode: null,
    });
  });

  it("requests one exact analysis date", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...base, localDate: "2026-08-15", assetOpinions: [] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchBriefing("2026-08-15");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/smart-insights/briefing?date=2026-08-15",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("loads the bounded date catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ today: "2026-08-17", dates: ["2026-08-16"] })),
        ),
    );

    await expect(fetchBriefingDates()).resolves.toEqual({
      today: "2026-08-17",
      dates: ["2026-08-16"],
    });
  });
});
