import { describe, expect, it } from "vitest";

import type { PortfolioHoldingResponse, WatchlistItemResponse } from "@/lib/backend/types";
import type { AssetOpinionModel } from "@/lib/smart-insights-client";

import { buildAssetOpinionWorkspace } from "./asset-opinion-workspace";

function opinion(symbol: string, name = symbol): AssetOpinionModel {
  return {
    symbol,
    assetName: name,
    stance: "CONSTRUCTIVE",
    quantScore: "42",
    confidence: "70",
    horizon: "WEEKS_1_4",
    portfolioWeightPct: "0",
    unrealizedReturn: null,
    riskTolerance: "moderate",
    personalizedAction: "HOLD",
    pillars: [],
    thesis: `${symbol} thesis`,
    bullCase: `${symbol} bull case`,
    baseCase: `${symbol} base case`,
    bearCase: `${symbol} bear case`,
    invalidationConditions: [`${symbol} invalidation`],
    quantInvalidationConditions: [],
    formula: "asset_score = 42",
    totalContribution: "42",
    decisionInputs: [],
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    evidence: [],
    dataCoverage: "0.8",
    freshness: "fresh",
    explanationStatus: "accepted",
    failedGates: [],
  };
}

function favorite(
  symbol: string,
  overrides: Partial<WatchlistItemResponse> = {},
): WatchlistItemResponse {
  return {
    id: `favorite-${symbol.toLowerCase()}`,
    sym: symbol,
    name: `${symbol} tracked`,
    price: 100,
    chg: 1,
    alert: 0,
    sentiment: "neutral",
    datasetState: "ready",
    ingestionRequestId: null,
    backtestableTimeframes: ["1d"],
    currency: symbol === "FPT" ? "VND" : "USDT",
    hasMarketQuote: true,
    ...overrides,
  };
}

function holding(symbol: string): PortfolioHoldingResponse {
  return {
    assetId: `asset-${symbol.toLowerCase()}`,
    ticker: symbol,
    name: `${symbol} holding`,
    qty: 2,
    price: 120,
    cost: 90,
    value: 240,
    pnl: 60,
    pnlPct: 33.33,
    alloc: 25,
    sentiment: "Bullish",
    category: symbol === "FPT" ? "Stocks" : "Crypto",
    currency: symbol === "FPT" ? "VND" : "USDT",
  };
}

describe("buildAssetOpinionWorkspace", () => {
  it("deduplicates by canonical symbol and orders holdings, tracked assets, then defaults", () => {
    const result = buildAssetOpinionWorkspace({
      opinions: [opinion("BTC", "Bitcoin"), opinion("fpt"), opinion("ETH"), opinion("SOL")],
      watchlist: [favorite("eth"), favorite("FPT")],
      holdings: [holding("FPT")],
      watchlistAvailable: true,
      portfolioAvailable: true,
    });

    expect(result.map((item) => item.symbol)).toEqual([
      "FPT",
      "ETH",
      "BTC",
      "VNINDEX",
      "VN30",
      "XAU",
    ]);
    expect(result.find((item) => item.symbol === "FPT")).toMatchObject({
      name: "FPT holding",
      canRemove: false,
      canSell: true,
      backtestHref: "/quant-lab?symbols=FPT",
    });
    expect(result.find((item) => item.symbol === "ETH")).toMatchObject({
      canRemove: true,
      canSell: false,
      backtestHref: "/quant-lab?symbols=ETH",
    });
    expect(result.find((item) => item.symbol === "BTC")?.canRemove).toBe(false);
    expect(result.some((item) => item.symbol === "SOL")).toBe(false);
  });

  it("preserves published opinions when a source read is unavailable", () => {
    const result = buildAssetOpinionWorkspace({
      opinions: [opinion("SOL", "Solana")],
      watchlist: [],
      holdings: [],
      watchlistAvailable: false,
      portfolioAvailable: true,
    });

    expect(result.map((item) => item.symbol)).toEqual([
      "BTC",
      "ETH",
      "VNINDEX",
      "VN30",
      "XAU",
      "SOL",
    ]);
    expect(result.at(-1)).toMatchObject({ name: "Solana", opinion: { symbol: "SOL" } });
  });

  it("keeps new tracked assets visible without inventing an opinion or executable action", () => {
    const result = buildAssetOpinionWorkspace({
      opinions: [],
      watchlist: [
        favorite("ADA", {
          datasetState: "loading",
          backtestableTimeframes: [],
          price: 0,
          hasMarketQuote: false,
        }),
      ],
      holdings: [],
      watchlistAvailable: true,
      portfolioAvailable: true,
    });
    const ada = result.find((item) => item.symbol === "ADA");

    expect(ada).toMatchObject({
      opinion: null,
      price: null,
      datasetState: "loading",
      canRemove: true,
      canSell: false,
      backtestHref: null,
    });
  });

  it("caps the rendered workspace at twenty-five assets", () => {
    const watchlist = Array.from({ length: 30 }, (_, index) => favorite(`A${index}`));
    const result = buildAssetOpinionWorkspace({
      opinions: [],
      watchlist,
      holdings: [],
      watchlistAvailable: true,
      portfolioAvailable: true,
    });

    expect(result).toHaveLength(25);
    expect(result[0]?.symbol).toBe("A0");
    expect(result.slice(-5).map((item) => item.symbol)).toEqual([
      "BTC",
      "ETH",
      "VNINDEX",
      "VN30",
      "XAU",
    ]);
  });
});
