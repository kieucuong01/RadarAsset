import { describe, expect, it } from "vitest";

import { briefingSchema } from "./smart-insights-client";

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

describe("Smart Insights briefing contract", () => {
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
          pillars: [
            {
              code: "trend",
              score: "70",
              weight: "0.35",
              confidence: "80",
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
});
