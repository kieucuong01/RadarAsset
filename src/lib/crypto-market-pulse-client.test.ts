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
});
