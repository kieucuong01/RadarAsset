import { describe, expect, it } from "vitest";

import {
  applyPortfolioTransaction,
  buildPortfolioResponse,
  calculateRiskMetrics,
} from "./portfolio";
import type { PortfolioPositionInput, PortfolioTransactionInput } from "./types";

describe("portfolio backend domain", () => {
  const positions: PortfolioPositionInput[] = [
    {
      assetId: "asset-btc",
      symbol: "BTC",
      name: "Bitcoin",
      assetClass: "crypto",
      quantity: 0.85,
      averageCost: 54200,
      latestPrice: 67420,
    },
    {
      assetId: "asset-spy",
      symbol: "SPY",
      name: "S&P 500 ETF",
      assetClass: "etf",
      quantity: 45,
      averageCost: 510.2,
      latestPrice: 528.1,
    },
  ];

  it("builds total value, PnL, allocation, and holding rows from DB-shaped positions", () => {
    const response = buildPortfolioResponse({
      portfolioId: "portfolio-demo",
      portfolioName: "Demo Portfolio",
      baseCurrency: "USD",
      positions,
      transactions: [],
      performance: [
        { label: "D1", Portfolio: 100, Benchmark: 100 },
        { label: "D2", Portfolio: 102, Benchmark: 101 },
      ],
    });

    expect(response.totalValue).toBeCloseTo(81071.5, 2);
    expect(response.totalCost).toBeCloseTo(69029, 2);
    expect(response.totalPnL).toBeCloseTo(12042.5, 2);
    expect(response.totalPnLPct).toBeCloseTo(17.4456, 4);
    expect(response.holdings).toHaveLength(2);
    expect(response.holdings[0]).toMatchObject({
      ticker: "BTC",
      name: "Bitcoin",
      qty: 0.85,
      price: 67420,
      cost: 54200,
      value: 57307,
      pnl: 11237,
    });
    expect(response.allocation).toEqual([
      { category: "Crypto", value: 70.69 },
      { category: "Stocks", value: 29.31 },
    ]);
    expect(response.dayChangePct).toBe(2);
  });

  it("applies buy transactions with weighted average cost", () => {
    const current: PortfolioPositionInput = {
      assetId: "asset-btc",
      symbol: "BTC",
      name: "Bitcoin",
      assetClass: "crypto",
      quantity: 1,
      averageCost: 50000,
      latestPrice: 60000,
    };
    const tx: PortfolioTransactionInput = {
      type: "buy",
      assetId: "asset-btc",
      quantity: 0.5,
      price: 70000,
      fee: 10,
      executedAt: "2026-06-13T00:00:00.000Z",
    };

    const next = applyPortfolioTransaction(current, tx);

    expect(next.quantity).toBe(1.5);
    expect(next.averageCost).toBeCloseTo(56673.3333, 4);
  });

  it("applies new buy positions with fee included in cost basis", () => {
    const tx: PortfolioTransactionInput = {
      type: "buy",
      assetId: "asset-nvda",
      quantity: 2,
      price: 100,
      fee: 4,
      executedAt: "2026-06-13T00:00:00.000Z",
    };

    const next = applyPortfolioTransaction(null, tx);

    expect(next.quantity).toBe(2);
    expect(next.averageCost).toBe(102);
  });

  it("applies sell transactions without changing average cost while position remains open", () => {
    const current: PortfolioPositionInput = {
      assetId: "asset-spy",
      symbol: "SPY",
      name: "S&P 500 ETF",
      assetClass: "etf",
      quantity: 45,
      averageCost: 510.2,
      latestPrice: 528.1,
    };
    const tx: PortfolioTransactionInput = {
      type: "sell",
      assetId: "asset-spy",
      quantity: 5,
      price: 530,
      fee: 1,
      executedAt: "2026-06-13T00:00:00.000Z",
    };

    const next = applyPortfolioTransaction(current, tx);

    expect(next.quantity).toBe(40);
    expect(next.averageCost).toBe(510.2);
  });

  it("calculates production risk metrics from performance and allocation", () => {
    const metrics = calculateRiskMetrics({
      totalValue: 100000,
      allocation: [
        { category: "Crypto", value: 60 },
        { category: "Stocks", value: 30 },
        { category: "Cash", value: 10 },
      ],
      performance: [
        { label: "D1", Portfolio: 100, Benchmark: 100 },
        { label: "D2", Portfolio: 102, Benchmark: 101 },
        { label: "D3", Portfolio: 101, Benchmark: 100.5 },
        { label: "D4", Portfolio: 105, Benchmark: 102 },
        { label: "D5", Portfolio: 103, Benchmark: 101 },
      ],
    });

    expect(metrics).toHaveLength(6);
    expect(metrics.map((metric) => metric.key)).toEqual([
      "beta",
      "sharpe",
      "volatility",
      "maxDrawdown",
      "var95",
      "diversification",
    ]);
    expect(metrics.find((metric) => metric.key === "diversification")).toMatchObject({
      rawValue: 0.46,
      value: "C",
    });
    expect(metrics.find((metric) => metric.key === "var95")?.rawValue).toBeLessThan(0);
  });
});
