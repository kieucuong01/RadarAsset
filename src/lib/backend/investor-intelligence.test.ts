import { describe, expect, it } from "vitest";

import { buildAssetIntelligence } from "./investor-intelligence";
import type {
  ForecastPointInput,
  InsightEvidenceInput,
  InvestmentThesisInput,
  InvestorInsightInput,
} from "./types";

describe("investor intelligence domain", () => {
  it("combines sentiment, evidence, thesis, and forecasts into an investor-ready asset view", () => {
    const insights: InvestorInsightInput[] = [
      {
        id: "i1",
        source: "last30days",
        asset: "BTC",
        sentiment: "bull",
        title: "ETF inflows accelerate",
        summary: "Spot ETF demand has accelerated while exchange netflow remains negative.",
        publishedAt: "2026-07-26T09:00:00.000Z",
        confidence: 82,
        catalyst: "ETF inflows",
        risk: "Fed repricing",
      },
      {
        id: "i2",
        source: "Reuters",
        asset: "BTC",
        sentiment: "bear",
        title: "Real yields rise",
        summary: "Higher real yields can pressure high-beta assets.",
        publishedAt: "2026-07-25T09:00:00.000Z",
        confidence: 64,
        catalyst: null,
        risk: "Higher real yields",
      },
    ];
    const evidence: InsightEvidenceInput[] = [
      {
        id: "e1",
        insightId: "i1",
        sourceType: "reddit",
        sourceName: "r/Bitcoin",
        url: "https://example.com/reddit",
        title: "ETF flow discussion",
        excerpt: "Users are focused on persistent ETF inflows.",
        engagement: 420,
        observedAt: "2026-07-26T08:00:00.000Z",
      },
      {
        id: "e2",
        insightId: "i1",
        sourceType: "web",
        sourceName: "issuer report",
        url: null,
        title: "Issuer flow table",
        excerpt: "Daily flow table shows net inflows.",
        engagement: 0,
        observedAt: "2026-07-26T07:00:00.000Z",
      },
    ];
    const thesis: InvestmentThesisInput = {
      id: "t1",
      symbol: "BTC",
      stance: "accumulate",
      conviction: 78,
      thesis: "BTC trend remains constructive while ETF demand offsets macro pressure.",
      bearCase: "A hot inflation print could force deleveraging.",
      bullCase: "Continued ETF inflows can tighten liquid supply.",
      actionItems: ["Keep core exposure", "Avoid leverage into CPI"],
      updatedAt: "2026-07-26T10:00:00.000Z",
    };
    const forecasts: ForecastPointInput[] = [
      {
        horizon: "7d",
        targetPrice: 70400,
        lowerBound: 66000,
        upperBound: 72800,
        confidence: 61,
        model: "kronos-small",
        generatedAt: "2026-07-26T10:05:00.000Z",
      },
    ];

    const result = buildAssetIntelligence({
      symbol: "BTC",
      name: "Bitcoin",
      latestPrice: 67420,
      insights,
      evidence,
      thesis,
      forecasts,
    });

    expect(result.symbol).toBe("BTC");
    expect(result.score).toBeGreaterThan(65);
    expect(result.score).toBeLessThan(90);
    expect(result.stance).toBe("accumulate");
    expect(result.sentimentBreakdown).toEqual({ bull: 1, bear: 1, neutral: 0 });
    expect(result.topCatalysts).toContain("ETF inflows");
    expect(result.topRisks).toContain("Higher real yields");
    expect(result.evidenceCount).toBe(2);
    expect(result.forecasts[0]).toMatchObject({ horizon: "7d", expectedReturnPct: 4.42 });
  });

  it("returns a neutral empty state when no research is available", () => {
    const result = buildAssetIntelligence({
      symbol: "VN30",
      name: "VN30 Index",
      latestPrice: 1328.2,
      insights: [],
      evidence: [],
      thesis: null,
      forecasts: [],
    });

    expect(result.score).toBe(50);
    expect(result.stance).toBe("watch");
    expect(result.summary).toContain("No active research");
  });

  it("does not saturate the score with a single bullish research item", () => {
    const result = buildAssetIntelligence({
      symbol: "BTC",
      name: "Bitcoin",
      latestPrice: 67420,
      insights: [
        {
          id: "i1",
          source: "last30days",
          asset: "BTC",
          sentiment: "bull",
          title: "ETF inflows accelerate",
          summary: "Spot ETF demand has accelerated.",
          publishedAt: "2026-07-26T09:00:00.000Z",
          confidence: 82,
          catalyst: "ETF inflows",
          risk: "Fed repricing",
        },
      ],
      evidence: [
        {
          id: "e1",
          insightId: "i1",
          sourceType: "web",
          sourceName: "issuer report",
          url: null,
          title: "Issuer flow table",
          excerpt: "Daily flow table shows net inflows.",
          engagement: 0,
          observedAt: "2026-07-26T07:00:00.000Z",
        },
      ],
      thesis: {
        id: "t1",
        symbol: "BTC",
        stance: "accumulate",
        conviction: 78,
        thesis: "BTC trend remains constructive.",
        bearCase: "A hot inflation print could force deleveraging.",
        bullCase: "Continued ETF inflows can tighten liquid supply.",
        actionItems: ["Keep core exposure"],
        updatedAt: "2026-07-26T10:00:00.000Z",
      },
      forecasts: [
        {
          horizon: "7d",
          targetPrice: 70400,
          lowerBound: 66000,
          upperBound: 72800,
          confidence: 61,
          model: "kronos-small",
          generatedAt: "2026-07-26T10:05:00.000Z",
        },
      ],
    });

    expect(result.score).toBeGreaterThan(70);
    expect(result.score).toBeLessThan(90);
  });
});
