import { describe, expect, it } from "vitest";

import { cryptoMarketPulseSchema } from "./crypto-market-pulse-client";

const validPayload = {
  generatedAt: "2026-08-14T12:00:00.000Z",
  fearGreed: {
    status: "system",
    sourceCode: "alternative-fng",
    sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
    latest: {
      effectiveAt: "2026-08-12T00:00:00.000Z",
      value: 24,
      classification: "Extreme Fear",
    },
    series: [
      {
        effectiveAt: "2026-08-12T00:00:00.000Z",
        value: 24,
        classification: "Extreme Fear",
      },
    ],
  },
  etfFlows: {
    status: "partial",
    sourceCodes: ["farside-btc-etf", "farside-sol-etf"],
    series: [
      {
        effectiveAt: "2026-08-12T00:00:00.000Z",
        btc: 100,
        eth: null,
        sol: -25,
        total: 75,
      },
    ],
    summaries: [
      {
        asset: "BTC",
        latest: 100,
        fiveDay: 150,
        thirtyDay: 200,
        latestEffectiveAt: "2026-08-12T00:00:00.000Z",
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
    status: "system",
    sourceCode: "coinglass-margin-borrow",
    sourceUrl: "https://www.coinglass.com/pro/i/MarginFeeChart",
    observedAt: "2026-08-14T22:05:00.000Z",
    series: [
      {
        effectiveAt: "2026-08-14T22:00:00.000Z",
        annualizedRate: 4.05,
        dailyRate: 0.0113,
        hourlyRate: 0.000469,
      },
    ],
  },
  liquidationMaxPain: {
    status: "system",
    sourceCode: "coinglass-liquidation-maxpain",
    sourceUrl: "https://www.coinglass.com/liquidation-maxpain",
    observedAt: "2026-08-14T22:05:00.000Z",
    rows: [
      {
        asset: "BTC",
        range: "24h",
        effectiveAt: "2026-08-14T22:00:00.000Z",
        currentPriceUsd: 62609.4,
        long: { priceUsd: 60000, levelUsd: 98500000, distanceRatio: -0.0417 },
        short: { priceUsd: 65000, levelUsd: 120000000, distanceRatio: 0.0382 },
      },
    ],
  },
  cycleIndicators: {
    altcoinSeason: {
      status: "system",
      sourceCode: "blockchaincenter-altcoin-season",
      sourceUrl: "https://www.blockchaincenter.net/altcoin-season-index/",
      observedAt: "2026-08-14T01:00:00.000Z",
      latest: {
        effectiveAt: "2026-08-14T00:00:00.000Z",
        season90d: 61,
        month: 43,
        year: 37,
        classification: "neutral",
      },
      series: [],
    },
    cbbi: {
      status: "system",
      sourceCode: "cbbi-public",
      sourceUrl: "https://colintalkscrypto.com/cbbi/",
      observedAt: "2026-08-14T01:00:00.000Z",
      latest: {
        effectiveAt: "2026-08-14T00:00:00.000Z",
        confidence: 31.34,
        components: [
          "pi_cycle",
          "rupl_nupl",
          "rhodl",
          "puell",
          "two_year_ma",
          "trolololo",
          "mvrv",
          "reserve_risk",
          "woobull",
        ].map((code, index) => ({ code, value: 20 + index })),
      },
      series: [],
    },
  },
  largeAddressActivity: {
    status: "system",
    sourceCodes: ["mempool-btc-large-addresses", "bitinfocharts-top-addresses"],
    effectiveAt: "2026-08-14T00:00:00.000Z",
    universeObservedAt: "2026-08-14T01:00:00.000Z",
    score: 42.5,
    state: "accumulation",
    confidence: 88.5,
    calibrationStatus: "calibrated",
    horizons: {
      oneDay: {
        netAccumulationBtc: 15,
        accumulationBreadth: 0.6,
        distributionBreadth: 0.2,
        accumulatingCount: 3,
        distributingCount: 1,
        unchangedCount: 1,
      },
      sevenDay: {
        netAccumulationBtc: null,
        accumulationBreadth: null,
        distributionBreadth: null,
        accumulatingCount: null,
        distributingCount: null,
        unchangedCount: null,
      },
      thirtyDay: {
        netAccumulationBtc: null,
        accumulationBreadth: null,
        distributionBreadth: null,
        accumulatingCount: null,
        distributingCount: null,
        unchangedCount: null,
      },
    },
    exchangeFlows: [
      {
        effectiveAt: "2026-08-14T00:00:00.000Z",
        toExchangeBtc: 25,
        fromExchangeBtc: 10,
        pressureBtc: 15,
      },
    ],
    concentrationSeries: [{ effectiveAt: "2026-08-14T00:00:00.000Z", top10Ratio: 0.72 }],
    breadthSeries: [
      {
        effectiveAt: "2026-08-14T00:00:00.000Z",
        netAccumulationBtc: 15,
        accumulationBreadth: 0.6,
        distributionBreadth: 0.2,
        accumulatingCount: 3,
        distributingCount: 1,
        unchangedCount: 1,
      },
    ],
    notableActivity: [
      {
        effectiveAt: "2026-08-14T00:00:00.000Z",
        address: "bc1whale",
        valueBtc: 20,
        direction: "outgoing",
        counterparty: "unknown",
        txid: "tx-1",
        sourceUrl: "https://mempool.space/address/bc1whale",
        explorerUrl: "https://mempool.space/tx/tx-1",
      },
    ],
    entrantsExits: {
      entrantCount: 1,
      exitCount: 0,
      entrantBalanceBtc: 1250,
      exitBalanceBtc: 0,
    },
    qualityFlags: [],
    sources: [
      {
        sourceCode: "mempool-btc-large-addresses",
        sourceUrl: "https://mempool.space/",
        observedAt: "2026-08-14T01:00:00.000Z",
      },
    ],
    methodologyVersion: "btc-large-address-action-v1",
  },
};

describe("Crypto Market Pulse client contract", () => {
  it("accepts nullable ETF asset values", () => {
    expect(cryptoMarketPulseSchema.parse(validPayload).etfFlows.series[0]?.eth).toBeNull();
  });

  it("rejects an invalid source status", () => {
    expect(() =>
      cryptoMarketPulseSchema.parse({
        ...validPayload,
        etfFlows: { ...validPayload.etfFlows, status: "seed" },
      }),
    ).toThrow();
  });

  it("rejects malformed flow rows", () => {
    expect(() =>
      cryptoMarketPulseSchema.parse({
        ...validPayload,
        etfFlows: {
          ...validPayload.etfFlows,
          series: [{ effectiveAt: "x", btc: "100", eth: null, sol: null, total: 100 }],
        },
      }),
    ).toThrow();
  });

  it("accepts the BTC large-address activity contract", () => {
    const parsed = cryptoMarketPulseSchema.parse(validPayload);

    expect(parsed.largeAddressActivity?.horizons.oneDay.netAccumulationBtc).toBe(15);
    expect(parsed.largeAddressActivity?.notableActivity[0]?.txid).toBe("tx-1");
  });

  it("remains compatible with payloads served before large-address activity", () => {
    const { largeAddressActivity: _omitted, ...legacyPayload } = validPayload;

    expect(cryptoMarketPulseSchema.parse(legacyPayload).largeAddressActivity).toBeUndefined();
  });

  it("rejects malformed large-address breadth values", () => {
    expect(() =>
      cryptoMarketPulseSchema.parse({
        ...validPayload,
        largeAddressActivity: {
          ...validPayload.largeAddressActivity,
          horizons: {
            ...validPayload.largeAddressActivity.horizons,
            oneDay: {
              ...validPayload.largeAddressActivity.horizons.oneDay,
              accumulationBreadth: "60%",
            },
          },
        },
      }),
    ).toThrow();
  });

  it("requires all crawled pressure and cycle sections", () => {
    const { cycleIndicators: _omitted, ...missingCycle } = validPayload;
    expect(() => cryptoMarketPulseSchema.parse(missingCycle)).toThrow();
  });

  it("rejects duplicate CBBI components and duplicate liquidation assets", () => {
    const duplicateComponent = validPayload.cycleIndicators.cbbi.latest!.components[0]!;
    expect(() =>
      cryptoMarketPulseSchema.parse({
        ...validPayload,
        cycleIndicators: {
          ...validPayload.cycleIndicators,
          cbbi: {
            ...validPayload.cycleIndicators.cbbi,
            latest: {
              ...validPayload.cycleIndicators.cbbi.latest!,
              components: [
                ...validPayload.cycleIndicators.cbbi.latest!.components.slice(0, -1),
                duplicateComponent,
              ],
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      cryptoMarketPulseSchema.parse({
        ...validPayload,
        liquidationMaxPain: {
          ...validPayload.liquidationMaxPain,
          rows: [
            validPayload.liquidationMaxPain.rows[0],
            validPayload.liquidationMaxPain.rows[0],
          ],
        },
      }),
    ).toThrow();
  });
});
