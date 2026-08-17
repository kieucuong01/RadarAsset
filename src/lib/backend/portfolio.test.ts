import { describe, expect, it } from "vitest";

import {
  applyPortfolioTransaction,
  buildPortfolioPerformance,
  buildPortfolioResponse,
  buildTradeAwarePerformance,
  calculateRiskMetrics,
  isSupportedPortfolioAsset,
  replayPortfolioLedger,
} from "./portfolio";
import type {
  PortfolioLedgerAsset,
  PortfolioLedgerTransaction,
  PortfolioHistoricalBar,
  PortfolioPositionInput,
  PortfolioTransactionInput,
} from "./types";

describe("portfolio backend domain", () => {
  it("supports Vietnamese equities, crypto and gold but rejects foreign equities", () => {
    expect(isSupportedPortfolioAsset({ assetClass: "equity", market: "vn_equity" })).toBe(true);
    expect(isSupportedPortfolioAsset({ assetClass: "index", market: "vn_equity" })).toBe(true);
    expect(isSupportedPortfolioAsset({ assetClass: "crypto", market: "crypto_spot" })).toBe(true);
    expect(
      isSupportedPortfolioAsset({ symbol: "XMR", assetClass: "crypto", market: "crypto_spot" }),
    ).toBe(false);
    expect(isSupportedPortfolioAsset({ assetClass: "commodity", market: "metal_spot" })).toBe(true);
    expect(isSupportedPortfolioAsset({ assetClass: "equity", market: "other" })).toBe(false);
    expect(isSupportedPortfolioAsset({ assetClass: "etf", market: "us_equity" })).toBe(false);
  });

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
      assetId: "asset-vnindex",
      symbol: "VNINDEX",
      name: "VN-Index",
      assetClass: "index",
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

  it("combines realized and unrealized PnL against cumulative buy capital", () => {
    const response = buildPortfolioResponse({
      portfolioId: "portfolio-demo",
      portfolioName: "Demo Portfolio",
      baseCurrency: "USD",
      positions: [
        {
          assetId: "asset-btc",
          symbol: "BTC",
          name: "Bitcoin",
          assetClass: "crypto",
          quantity: 1,
          averageCost: 100,
          latestPrice: 120,
        },
      ],
      transactions: [],
      performance: [],
      realizedPnL: 10,
      cumulativeBuyCapital: 200,
    });

    expect(response).toMatchObject({
      totalValue: 120,
      totalCost: 100,
      unrealizedPnL: 20,
      realizedPnL: 10,
      totalPnL: 30,
      totalPnLPct: 15,
      cumulativeBuyCapital: 200,
    });
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
      assetId: "asset-fpt",
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
      assetId: "asset-fpt",
      symbol: "FPT",
      name: "FPT Corporation",
      assetClass: "equity",
      quantity: 45,
      averageCost: 510.2,
      latestPrice: 528.1,
    };
    const tx: PortfolioTransactionInput = {
      type: "sell",
      assetId: "asset-fpt",
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

  describe("transaction ledger accounting", () => {
    const assets: PortfolioLedgerAsset[] = [
      {
        assetId: "asset-btc",
        symbol: "BTC",
        name: "Bitcoin",
        assetClass: "crypto",
        latestPrice: 62000,
        currency: "USDT",
      },
    ];

    const transaction = (
      overrides: Partial<PortfolioLedgerTransaction>,
    ): PortfolioLedgerTransaction => ({
      id: "tx-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      executedAt: "2026-01-01T00:00:00.000Z",
      type: "buy",
      assetId: "asset-btc",
      symbol: "BTC",
      quantity: 1,
      price: 50000,
      fee: 0,
      note: null,
      ...overrides,
    });

    it("replays buys and a partial sell with weighted cost and realized PnL", () => {
      const result = replayPortfolioLedger({
        assets,
        transactions: [
          transaction({}),
          transaction({
            id: "tx-2",
            createdAt: "2026-01-02T00:00:00.000Z",
            executedAt: "2026-01-02T00:00:00.000Z",
            quantity: 0.5,
            price: 70000,
            fee: 10,
          }),
          transaction({
            id: "tx-3",
            createdAt: "2026-01-03T00:00:00.000Z",
            executedAt: "2026-01-03T00:00:00.000Z",
            type: "sell",
            quantity: 0.5,
            price: 62000,
            fee: 10,
          }),
        ],
      });

      expect(result.positions).toHaveLength(1);
      expect(result.positions[0]).toMatchObject({
        assetId: "asset-btc",
        quantity: 1,
      });
      expect(result.positions[0].averageCost).toBeCloseTo(56673.333333333336, 8);
      expect(result.transactions.at(-1)).toMatchObject({
        type: "sell",
        grossAmount: 31000,
        netAmount: 30990,
        remainingQuantity: 1,
        currency: "USDT",
      });
      expect(result.positions[0]).toMatchObject({ currency: "USDT" });
      expect(result.transactions.at(-1)?.releasedCostBasis).toBeCloseTo(28336.666666666668, 8);
      expect(result.transactions.at(-1)?.realizedPnL).toBeCloseTo(2653.333333333332, 8);
      expect(result.realizedPnL).toBeCloseTo(2653.333333333332, 8);
      expect(result.cumulativeBuyCapital).toBe(85010);
    });

    it("includes the first buy fee in cost basis and removes a fully sold position", () => {
      const result = replayPortfolioLedger({
        assets,
        transactions: [
          transaction({ quantity: 2, price: 100, fee: 4 }),
          transaction({
            id: "tx-2",
            createdAt: "2026-01-02T00:00:00.000Z",
            executedAt: "2026-01-02T00:00:00.000Z",
            type: "sell",
            quantity: 2,
            price: 120,
            fee: 2,
          }),
        ],
      });

      expect(result.positions).toEqual([]);
      expect(result.transactions[0]).toMatchObject({
        netAmount: -204,
        remainingQuantity: 2,
      });
      expect(result.transactions[1]).toMatchObject({
        releasedCostBasis: 204,
        netAmount: 238,
        realizedPnL: 34,
        remainingQuantity: 0,
      });
    });

    it("rejects selling without a position or above the quantity available at that time", () => {
      expect(() =>
        replayPortfolioLedger({
          assets,
          transactions: [transaction({ type: "sell", quantity: 1, price: 60000 })],
        }),
      ).toThrow("Cannot sell BTC because no position is available at this transaction time.");

      expect(() =>
        replayPortfolioLedger({
          assets,
          transactions: [
            transaction({ quantity: 1 }),
            transaction({
              id: "tx-2",
              createdAt: "2026-01-02T00:00:00.000Z",
              executedAt: "2026-01-02T00:00:00.000Z",
              type: "sell",
              quantity: 2,
            }),
          ],
        }),
      ).toThrow("Cannot sell 2 BTC; only 1 is available at this transaction time.");
    });

    it("reorders backdated events by execution time before calculating later sells", () => {
      const result = replayPortfolioLedger({
        assets,
        transactions: [
          transaction({
            id: "tx-sell",
            createdAt: "2026-01-03T00:00:00.000Z",
            executedAt: "2026-01-02T00:00:00.000Z",
            type: "sell",
            quantity: 1,
            price: 130,
          }),
          transaction({
            id: "tx-buy",
            createdAt: "2026-01-04T00:00:00.000Z",
            executedAt: "2026-01-01T00:00:00.000Z",
            quantity: 2,
            price: 100,
          }),
        ],
      });

      expect(result.positions[0]).toMatchObject({ quantity: 1, averageCost: 100 });
      expect(result.transactions.map((item) => item.id)).toEqual(["tx-buy", "tx-sell"]);
      expect(result.realizedPnL).toBe(30);
    });

    it("uses creation time and identifier to order equal execution timestamps deterministically", () => {
      const result = replayPortfolioLedger({
        assets,
        transactions: [
          transaction({
            id: "tx-b",
            createdAt: "2026-01-01T00:00:01.000Z",
            quantity: 1,
            price: 200,
          }),
          transaction({
            id: "tx-a",
            createdAt: "2026-01-01T00:00:00.000Z",
            quantity: 1,
            price: 100,
          }),
        ],
      });

      expect(result.transactions.map((item) => item.id)).toEqual(["tx-a", "tx-b"]);
      expect(result.positions[0].averageCost).toBe(150);
    });
  });

  describe("trade-aware performance", () => {
    const assets: PortfolioLedgerAsset[] = [
      {
        assetId: "asset-btc",
        symbol: "BTC",
        name: "Bitcoin",
        assetClass: "crypto",
        latestPrice: 121,
      },
      {
        assetId: "asset-vnindex",
        symbol: "VNINDEX",
        name: "VN-Index",
        assetClass: "index",
        latestPrice: 102.01,
      },
    ];
    const bars: PortfolioHistoricalBar[] = [
      { assetId: "asset-btc", ts: "2026-01-01T00:00:00.000Z", close: 100 },
      { assetId: "asset-btc", ts: "2026-01-02T00:00:00.000Z", close: 110 },
      { assetId: "asset-btc", ts: "2026-01-03T00:00:00.000Z", close: 121 },
      { assetId: "asset-vnindex", ts: "2026-01-01T00:00:00.000Z", close: 100 },
      { assetId: "asset-vnindex", ts: "2026-01-02T00:00:00.000Z", close: 101 },
      { assetId: "asset-vnindex", ts: "2026-01-03T00:00:00.000Z", close: 102.01 },
    ];
    const transaction = (
      overrides: Partial<PortfolioLedgerTransaction>,
    ): PortfolioLedgerTransaction => ({
      id: "tx-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      executedAt: "2026-01-01T00:00:00.000Z",
      type: "buy",
      assetId: "asset-btc",
      symbol: "BTC",
      quantity: 1,
      price: 100,
      fee: 0,
      note: null,
      ...overrides,
    });

    it("removes external Buy flows without backcasting the new quantity", () => {
      const points = buildTradeAwarePerformance({
        assets,
        transactions: [
          transaction({}),
          transaction({
            id: "tx-2",
            createdAt: "2026-01-02T00:00:00.000Z",
            executedAt: "2026-01-02T00:00:00.000Z",
            quantity: 1,
            price: 110,
          }),
        ],
        bars,
        benchmarkAssetId: "asset-vnindex",
        limit: 30,
      });

      expect(points).toEqual([
        { label: "Jan 1", Portfolio: 100, Benchmark: 100 },
        { label: "Jan 2", Portfolio: 110, Benchmark: 101 },
        { label: "Jan 3", Portfolio: 121, Benchmark: 102.01 },
      ]);
    });

    it("treats Buy fees as a performance cost", () => {
      const points = buildTradeAwarePerformance({
        assets,
        transactions: [
          transaction({}),
          transaction({
            id: "tx-2",
            createdAt: "2026-01-02T00:00:00.000Z",
            executedAt: "2026-01-02T00:00:00.000Z",
            quantity: 1,
            price: 110,
            fee: 10,
          }),
        ],
        bars,
        benchmarkAssetId: "asset-vnindex",
        limit: 30,
      });

      expect(points.map((point) => point.Portfolio)).toEqual([100, 100, 110]);
    });

    it("removes Sell withdrawals while keeping the return on the held quantity", () => {
      const points = buildTradeAwarePerformance({
        assets,
        transactions: [
          transaction({ quantity: 2 }),
          transaction({
            id: "tx-2",
            createdAt: "2026-01-03T00:00:00.000Z",
            executedAt: "2026-01-02T00:00:00.000Z",
            type: "sell",
            quantity: 1,
            price: 110,
          }),
        ],
        bars,
        benchmarkAssetId: "asset-vnindex",
        limit: 30,
      });

      expect(points.map((point) => point.Portfolio)).toEqual([100, 110, 121]);
    });

    it("carries a weekend Buy flow to the next valid valuation point", () => {
      const points = buildTradeAwarePerformance({
        assets,
        transactions: [
          transaction({}),
          transaction({
            id: "tx-weekend",
            createdAt: "2026-01-04T00:00:00.000Z",
            executedAt: "2026-01-04T00:00:00.000Z",
            quantity: 1,
            price: 110,
          }),
        ],
        bars: bars.map((bar) => ({
          ...bar,
          ts:
            bar.ts === "2026-01-02T00:00:00.000Z"
              ? "2026-01-05T00:00:00.000Z"
              : bar.ts === "2026-01-03T00:00:00.000Z"
                ? "2026-01-06T00:00:00.000Z"
                : bar.ts,
        })),
        benchmarkAssetId: "asset-vnindex",
        limit: 30,
      });

      expect(points.map((point) => point.Portfolio)).toEqual([100, 110, 121]);
    });

    it("records a full liquidation return and resumes cleanly after re-entry", () => {
      const points = buildTradeAwarePerformance({
        assets,
        transactions: [
          transaction({}),
          transaction({
            id: "tx-exit",
            createdAt: "2026-01-02T00:00:00.000Z",
            executedAt: "2026-01-02T00:00:00.000Z",
            type: "sell",
            quantity: 1,
            price: 110,
          }),
          transaction({
            id: "tx-reentry",
            createdAt: "2026-01-03T00:00:00.000Z",
            executedAt: "2026-01-03T00:00:00.000Z",
            quantity: 1,
            price: 121,
          }),
        ],
        bars,
        benchmarkAssetId: "asset-vnindex",
        limit: 30,
      });

      expect(points.map((point) => point.Portfolio)).toEqual([100, 110, 110]);
    });

    it("starts the benchmark at its first available mark", () => {
      const points = buildTradeAwarePerformance({
        assets,
        transactions: [transaction({})],
        bars: bars.filter(
          (bar) => bar.assetId !== "asset-vnindex" || bar.ts !== "2026-01-01T00:00:00.000Z",
        ),
        benchmarkAssetId: "asset-vnindex",
        limit: 30,
      });

      expect(points.map((point) => point.Benchmark)).toEqual([100, 100, 101]);
    });

    it("returns no fabricated performance when no held asset has price history", () => {
      const points = buildTradeAwarePerformance({
        assets,
        transactions: [transaction({})],
        bars: bars.filter((bar) => bar.assetId === "asset-vnindex"),
        benchmarkAssetId: "asset-vnindex",
        limit: 30,
      });

      expect(points).toEqual([]);
    });

    it("values a cash-flow-matched VNINDEX counterfactual in portfolio money", () => {
      const result = buildPortfolioPerformance({
        assets,
        transactions: [
          transaction({}),
          transaction({
            id: "tx-2",
            createdAt: "2026-01-02T00:00:00.000Z",
            executedAt: "2026-01-02T00:00:00.000Z",
            quantity: 1,
            price: 110,
          }),
          transaction({
            id: "tx-3",
            createdAt: "2026-01-03T00:00:00.000Z",
            executedAt: "2026-01-03T00:00:00.000Z",
            type: "sell",
            quantity: 0.5,
            price: 121,
            fee: 1,
          }),
        ],
        bars,
        benchmarkAssetId: "asset-vnindex",
        limit: 30,
      });

      expect(result.performance.at(-1)).toMatchObject({
        portfolioValue: 181.5,
        benchmarkValue: 153.61,
      });
      expect(result.benchmark).toMatchObject({
        symbol: "VNINDEX",
        portfolioValue: 181.5,
        benchmarkValue: 153.61,
        excessValue: 27.89,
      });
      expect(result.benchmark.portfolioReturnPct).toBeCloseTo(14.7619, 4);
      expect(result.benchmark.benchmarkReturnPct).toBeCloseTo(1.481, 4);
      expect(result.benchmark.excessReturnPct).toBeCloseTo(13.281, 4);
    });
  });
});
