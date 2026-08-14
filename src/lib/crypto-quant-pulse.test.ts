import { describe, expect, it } from "vitest";

import type { CryptoMarketPulseModel } from "./crypto-market-pulse-client";
import { buildCryptoMetricSeries, buildCryptoOverviewObservations } from "./crypto-quant-pulse";
import type { MetricModel } from "./smart-insights-client";

function metric(overrides: Partial<MetricModel> = {}): MetricModel {
  return {
    observationId: "obs-1",
    metricCode: "crypto.derivatives.btc_dvol",
    market: "crypto",
    asset: "BTC",
    value: "18",
    unit: "percent",
    delta: null,
    percentile: null,
    effectiveStart: "2026-08-12T00:00:00.000Z",
    effectiveEnd: "2026-08-12T00:00:00.000Z",
    observedAt: "2026-08-12T01:00:00.000Z",
    sourceCode: "deribit-public",
    sourceUrl: "https://www.deribit.com/statistics/BTC/volatility-index",
    freshness: "fresh",
    qualityWarnings: [],
    methodologyVersion: "v1",
    ...overrides,
  };
}

describe("buildCryptoMetricSeries", () => {
  it("groups by metric, asset, unit, and source then sorts chronologically", () => {
    const series = buildCryptoMetricSeries([
      metric({ observationId: "later", value: "20", effectiveStart: "2026-08-14T00:00:00Z" }),
      metric({ observationId: "earlier", value: "18", effectiveStart: "2026-08-12T00:00:00Z" }),
      metric({ observationId: "eth", asset: "ETH", value: "25" }),
      metric({ observationId: "usd", unit: "usd", value: "100" }),
      metric({ observationId: "other-source", sourceCode: "other", value: "19" }),
    ]);

    expect(series).toHaveLength(4);
    expect(series[0]?.key).toBe("crypto.derivatives.btc_dvol:BTC:percent:deribit-public");
    expect(series[0]?.points.map((point) => point.value)).toEqual([18, 20]);
  });

  it("keeps one observation as a snapshot and never invents zero-filled gaps", () => {
    const [single] = buildCryptoMetricSeries([metric()]);
    expect(single?.trendPoints).toEqual([]);

    const [gapped] = buildCryptoMetricSeries([
      metric({ observationId: "one", value: "18", effectiveStart: "2026-08-01T00:00:00Z" }),
      metric({ observationId: "three", value: "20", effectiveStart: "2026-08-03T00:00:00Z" }),
    ]);
    expect(gapped?.points).toEqual([
      { effectiveAt: "2026-08-01T00:00:00Z", value: 18 },
      { effectiveAt: "2026-08-03T00:00:00Z", value: 20 },
    ]);
    expect(gapped?.points.some((point) => point.value === 0)).toBe(false);
  });

  it("drops non-finite metric values instead of coercing them to zero", () => {
    expect(buildCryptoMetricSeries([metric({ value: "not-a-number" })])).toEqual([]);
  });
});

describe("buildCryptoOverviewObservations", () => {
  it("returns at most three sourced, effective-dated observations in cycle-first priority", () => {
    const pulse = {
      fearGreed: {
        sourceCode: "alternative-fng",
        sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
        latest: { effectiveAt: "2026-08-14T00:00:00Z", value: 48, classification: "Neutral" },
      },
      etfFlows: {
        sourceCodes: ["farside-btc-etf"],
        series: [{ effectiveAt: "2026-08-14T00:00:00Z", total: 12_000_000 }],
      },
      liquidationMaxPain: {
        sourceCode: "coinglass-liquidation-maxpain",
        sourceUrl: "https://www.coinglass.com/liquidation-maxpain",
        rows: [
          {
            asset: "BTC",
            effectiveAt: "2026-08-14T12:00:00Z",
            long: { distanceRatio: -0.04 },
            short: { distanceRatio: 0.06 },
          },
        ],
      },
      cycleIndicators: {
        altcoinSeason: {
          sourceCode: "blockchaincenter-altcoin-season",
          sourceUrl: "https://www.blockchaincenter.net/altcoin-season-index/",
          latest: { effectiveAt: "2026-08-14T00:00:00Z", season90d: 61 },
        },
        cbbi: {
          sourceCode: "cbbi-public",
          sourceUrl: "https://colintalkscrypto.com/cbbi/",
          latest: { effectiveAt: "2026-08-14T00:00:00Z", confidence: 31.34 },
        },
      },
    } as unknown as CryptoMarketPulseModel;

    const observations = buildCryptoOverviewObservations(pulse);

    expect(observations).toHaveLength(3);
    expect(observations.map((row) => row.code)).toEqual([
      "cbbi-confidence",
      "altcoin-season-90d",
      "btc-liquidation-distance",
    ]);
    expect(observations.every((row) => row.sourceUrl && row.effectiveAt)).toBe(true);
    expect(JSON.stringify(observations).toLowerCase()).not.toMatch(/\bbuy\b|\bsell\b/);
  });

  it("skips unavailable higher-priority readings instead of fabricating values", () => {
    const pulse = {
      fearGreed: {
        sourceCode: "alternative-fng",
        sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
        latest: { effectiveAt: "2026-08-14T00:00:00Z", value: 48, classification: "Neutral" },
      },
      etfFlows: { sourceCodes: [], series: [] },
      liquidationMaxPain: { rows: [] },
      cycleIndicators: {
        altcoinSeason: { latest: null },
        cbbi: { latest: null },
      },
    } as unknown as CryptoMarketPulseModel;

    expect(buildCryptoOverviewObservations(pulse).map((row) => row.code)).toEqual(["fear-greed"]);
  });
});
