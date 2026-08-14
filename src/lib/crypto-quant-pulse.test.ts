import { describe, expect, it } from "vitest";

import {
  buildCryptoMetricSeries,
  buildCryptoOverviewObservations,
  DERIVATIVE_METRIC_CODES,
  mergeSeriesPoints,
} from "./crypto-quant-pulse";
import { cryptoMarketPulseSchema } from "./crypto-market-pulse-client";
import type { MetricModel } from "./smart-insights-client";

function metric(
  observationId: string,
  metricCode: string,
  value: string,
  effectiveStart: string,
  unit = "ratio",
  asset: string | null = "BTC",
  sourceCode = "coinmetrics-community",
): MetricModel {
  return {
    observationId,
    metricCode,
    market: "crypto",
    asset,
    value,
    unit,
    delta: null,
    percentile: null,
    effectiveStart,
    effectiveEnd: effectiveStart,
    observedAt: effectiveStart,
    sourceCode,
    sourceUrl: `https://example.test/${sourceCode}`,
    freshness: "fresh",
    qualityWarnings: [],
    methodologyVersion: "v1",
  };
}

const pulse = cryptoMarketPulseSchema.parse({
  generatedAt: "2026-08-14T00:00:00Z",
  fearGreed: {
    status: "system",
    sourceCode: "alternative-fng",
    sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
    latest: { effectiveAt: "2026-08-14T00:00:00Z", value: 62, classification: "Greed" },
    series: [{ effectiveAt: "2026-08-14T00:00:00Z", value: 62, classification: "Greed" }],
  },
  etfFlows: {
    status: "system",
    sourceCodes: ["farside-btc-etf", "farside-eth-etf", "farside-sol-etf"],
    series: [{ effectiveAt: "2026-08-14T00:00:00Z", btc: 10, eth: 2, sol: -1, total: 11 }],
    summaries: [
      {
        asset: "BTC",
        latest: 10,
        fiveDay: 20,
        thirtyDay: 40,
        latestEffectiveAt: "2026-08-14T00:00:00Z",
      },
      {
        asset: "ETH",
        latest: 2,
        fiveDay: 3,
        thirtyDay: 5,
        latestEffectiveAt: "2026-08-14T00:00:00Z",
      },
      {
        asset: "SOL",
        latest: -1,
        fiveDay: 1,
        thirtyDay: 2,
        latestEffectiveAt: "2026-08-14T00:00:00Z",
      },
    ],
  },
  fundFlows: {
    status: "unavailable",
    sourceCode: "coinshares-weekly",
    sourceUrl: "https://coinshares.com/corp/resources/market-activity/",
    series: [],
    latestBreakdown: [],
  },
  marginBorrow: {
    status: "unavailable",
    sourceCode: "coinglass-margin-borrow",
    sourceUrl: "https://www.coinglass.com/pro/i/MarginFeeChart",
    observedAt: null,
    series: [],
  },
  liquidationMaxPain: {
    status: "unavailable",
    sourceCode: "coinglass-liquidation-maxpain",
    sourceUrl: "https://www.coinglass.com/liquidation-maxpain",
    observedAt: null,
    rows: [],
  },
  cycleIndicators: {
    altcoinSeason: {
      status: "unavailable",
      sourceCode: "blockchaincenter-altcoin-season",
      sourceUrl: "https://www.blockchaincenter.net/altcoin-season-index/",
      observedAt: null,
      latest: null,
      series: [],
    },
    cbbi: {
      status: "unavailable",
      sourceCode: "cbbi-public",
      sourceUrl: "https://colintalkscrypto.com/cbbi/",
      observedAt: null,
      latest: null,
      series: [],
    },
  },
});

describe("Crypto Quant Pulse chart model", () => {
  it("sorts points and keeps asset and unit boundaries", () => {
    const rows = [
      metric("2", "crypto.onchain.nvt", "20", "2026-08-14T00:00:00Z"),
      metric("1", "crypto.onchain.nvt", "18", "2026-08-13T00:00:00Z"),
      metric("3", "crypto.onchain.nvt", "9", "2026-08-14T00:00:00Z", "ratio", "ETH"),
    ];

    const series = buildCryptoMetricSeries(rows, new Set(["crypto.onchain.nvt"]));

    expect(series).toHaveLength(2);
    expect(series[0].points.map((point) => point.value)).toEqual([18, 20]);
    expect(series[0].trendPoints).toHaveLength(2);
    expect(series[1].asset).toBe("ETH");
  });

  it("keeps a single observation as a snapshot without a trend", () => {
    const [series] = buildCryptoMetricSeries(
      [metric("1", "crypto.onchain.mvrv", "1.8", "2026-08-14T00:00:00Z")],
      new Set(["crypto.onchain.mvrv"]),
    );

    expect(series.latest.value).toBe(1.8);
    expect(series.trendPoints).toEqual([]);
  });

  it("rejects non-finite metric values", () => {
    expect(
      buildCryptoMetricSeries(
        [metric("bad", "crypto.onchain.nvt", "not-a-number", "2026-08-14T00:00:00Z")],
        new Set(["crypto.onchain.nvt"]),
      ),
    ).toEqual([]);
  });

  it("excludes conflicting and unavailable observations from live series", () => {
    const conflicting = metric("conflicting", "crypto.onchain.nvt", "20", "2026-08-14T00:00:00Z");
    conflicting.freshness = "conflicting";
    const unavailable = metric("unavailable", "crypto.onchain.nvt", "21", "2026-08-14T00:00:00Z");
    unavailable.freshness = "unavailable";

    expect(
      buildCryptoMetricSeries([conflicting, unavailable], new Set(["crypto.onchain.nvt"])),
    ).toEqual([]);
  });

  it("merges compatible trend points without filling missing dates", () => {
    const series = buildCryptoMetricSeries(
      [
        metric("1", "crypto.derivatives.btc_dvol", "40", "2026-08-13T00:00:00Z", "index"),
        metric("2", "crypto.derivatives.btc_dvol", "42", "2026-08-14T00:00:00Z", "index"),
        metric("3", "crypto.derivatives.eth_dvol", "55", "2026-08-14T00:00:00Z", "index", "ETH"),
      ],
      DERIVATIVE_METRIC_CODES,
    );

    expect(mergeSeriesPoints(series)).toEqual([
      { effectiveAt: "2026-08-13T00:00:00Z", [series[0].key]: 40 },
      { effectiveAt: "2026-08-14T00:00:00Z", [series[0].key]: 42 },
    ]);
  });

  it("inserts a null breakpoint when a daily series has a missing period", () => {
    const [series] = buildCryptoMetricSeries(
      [
        metric("1", "crypto.onchain.nvt", "18", "2026-08-10T00:00:00Z"),
        metric("2", "crypto.onchain.nvt", "20", "2026-08-13T00:00:00Z"),
      ],
      new Set(["crypto.onchain.nvt"]),
    );

    expect(mergeSeriesPoints([series])).toEqual([
      { effectiveAt: "2026-08-10T00:00:00Z", [series.key]: 18 },
      { effectiveAt: "2026-08-11T00:00:00.000Z", [series.key]: null },
      { effectiveAt: "2026-08-13T00:00:00Z", [series.key]: 20 },
    ]);
  });

  it("builds sourced overview observations without recommendations", () => {
    const metrics = [
      metric(
        "onchain-change",
        "crypto.onchain.active_addresses_change_30d",
        "0.08",
        "2026-08-14T00:00:00Z",
        "return",
      ),
    ];

    const observations = buildCryptoOverviewObservations(pulse, metrics);

    expect(observations.map((item) => item.kind)).toEqual(["sentiment", "etf", "onchain"]);
    expect(observations).toHaveLength(3);
    expect(observations.find((item) => item.kind === "etf")?.unit).toBe("USD");
    expect(observations.every((item) => item.sourceCode && item.effectiveAt)).toBe(true);
    expect(observations.map((item) => item.label).join(" ")).not.toMatch(/mua|bán|buy|sell/i);
  });

  it("omits unavailable overview facts instead of inventing replacements", () => {
    const unavailable = cryptoMarketPulseSchema.parse({
      ...pulse,
      fearGreed: { ...pulse.fearGreed, status: "unavailable", latest: null, series: [] },
      etfFlows: { ...pulse.etfFlows, status: "unavailable", series: [], summaries: [] },
    });

    expect(buildCryptoOverviewObservations(unavailable, [])).toEqual([]);
    expect(buildCryptoOverviewObservations(null, [])).toEqual([]);
  });

  it("keeps independent on-chain facts when the Crypto Pulse request is unavailable", () => {
    const observations = buildCryptoOverviewObservations(null, [
      metric(
        "onchain-change",
        "crypto.onchain.active_addresses_change_30d",
        "0.08",
        "2026-08-14T00:00:00Z",
        "return",
      ),
    ]);

    expect(observations.map((item) => item.kind)).toEqual(["onchain"]);
  });

  it("excludes conflicting and unavailable on-chain facts from Overview", () => {
    const conflicting = metric(
      "conflicting-overview",
      "crypto.onchain.active_addresses_change_30d",
      "0.08",
      "2026-08-14T00:00:00Z",
      "return",
    );
    conflicting.freshness = "conflicting";
    const unavailable = metric(
      "unavailable-overview",
      "crypto.stablecoin.supply_change_7d",
      "0.03",
      "2026-08-14T00:00:00Z",
      "return",
    );
    unavailable.freshness = "unavailable";

    expect(buildCryptoOverviewObservations(null, [conflicting, unavailable])).toEqual([]);
  });

  it("derives stale Pulse freshness from effective time instead of assuming fresh", () => {
    const stalePulse = cryptoMarketPulseSchema.parse({
      ...pulse,
      generatedAt: "2026-08-14T12:00:00Z",
      fearGreed: {
        ...pulse.fearGreed,
        latest: { ...pulse.fearGreed.latest, effectiveAt: "2026-08-10T00:00:00Z" },
      },
      etfFlows: {
        ...pulse.etfFlows,
        series: [{ ...pulse.etfFlows.series[0], effectiveAt: "2026-08-10T00:00:00Z" }],
      },
    });

    const observations = buildCryptoOverviewObservations(stalePulse, []);
    expect(observations.map((item) => item.freshness)).toEqual(["stale", "stale"]);
  });

  it("prioritizes stale over partial when partial ETF data is older than the threshold", () => {
    const stalePartialPulse = cryptoMarketPulseSchema.parse({
      ...pulse,
      generatedAt: "2026-08-14T12:00:00Z",
      etfFlows: {
        ...pulse.etfFlows,
        status: "partial",
        series: [{ ...pulse.etfFlows.series[0], effectiveAt: "2026-08-10T00:00:00Z" }],
      },
    });

    expect(
      buildCryptoOverviewObservations(stalePartialPulse, []).find((item) => item.kind === "etf")
        ?.freshness,
    ).toBe("stale");
  });
});
