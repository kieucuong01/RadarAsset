import { describe, expect, it } from "vitest";

import type { BacktestResultModel } from "./result-model";
import {
  advancedAnalysisAvailability,
  alignEquityAndDrawdown,
  backtestOutputState,
  buildBacktestKpis,
  buildPortfolioTradeRows,
  filterPortfolioTradeRows,
} from "./result-presentation";

function modelWithTrades(): BacktestResultModel {
  const trade = (asset: "BTC" | "FPT", exitAt: string) => ({
    asset,
    side: "long" as const,
    entrySignalAt: "2026-01-01T00:00:00Z",
    entryAt: "2026-01-02T00:00:00Z",
    exitSignalAt: exitAt,
    exitAt,
    entryPrice: 100,
    exitPrice: 110,
    quantity: 1,
    fees: 1,
    slippageCost: 0.25,
    realizedPnl: 9,
    returnPct: 9,
    barsHeld: 2,
    exitReason: "signal" as const,
  });

  return {
    aggregate: {
      label: "Portfolio",
      metrics: {},
      equity: [],
      drawdown: [],
      contribution: [],
      cashFlow: [],
      rebalance: [],
      assumptions: {
        cashAllocationBps: 0,
        rebalanceFrequency: "none",
        monthlyContribution: 0,
        dividendMode: "exclude",
        fxPolicy: "normalized_returns",
        baseCurrency: "USD",
      },
      analytics: null,
      reportHtml: null,
    },
    legs: [
      {
        id: "leg-btc",
        symbol: "BTC",
        label: "BTC · MA Crossover",
        allocationBps: 5000,
        initialNotional: 500,
        strategyCode: "ma_crossover",
        strategyVersion: "1.0.0",
        strategyParameters: {},
        datasetVersionId: "dataset-btc",
        metrics: {},
        equity: [],
        drawdown: [],
        trades: [trade("BTC", "2026-01-04T00:00:00Z")],
      },
      {
        id: "leg-fpt",
        symbol: "FPT",
        label: "FPT · Turtle",
        allocationBps: 5000,
        initialNotional: 500,
        strategyCode: "turtle",
        strategyVersion: "1.0.0",
        strategyParameters: {},
        datasetVersionId: "dataset-fpt",
        metrics: {},
        equity: [],
        drawdown: [],
        trades: [trade("FPT", "2026-01-06T00:00:00Z")],
      },
    ],
  };
}

describe("backtest result presentation", () => {
  it("aligns drawdown to equity timestamps without inventing points", () => {
    expect(
      alignEquityAndDrawdown(
        [
          {
            timestamp: "2026-01-01T00:00:00Z",
            equity: 100,
            cash: 20,
            marketValue: 80,
            grossExposure: 80,
          },
          {
            timestamp: "2026-01-02T00:00:00Z",
            equity: 90,
            cash: 10,
            marketValue: 80,
            grossExposure: 80,
          },
        ],
        [{ timestamp: "2026-01-02T00:00:00Z", drawdownPct: -10 }],
      ),
    ).toEqual([
      { timestamp: "2026-01-01T00:00:00Z", equity: 100, drawdownPct: null },
      { timestamp: "2026-01-02T00:00:00Z", equity: 90, drawdownPct: -10 },
    ]);
  });

  it("aggregates completed trades newest-first and retains their leg context", () => {
    const rows = buildPortfolioTradeRows(modelWithTrades());

    expect(rows.map((row) => row.asset)).toEqual(["FPT", "BTC"]);
    expect(rows[0]).toMatchObject({
      legId: "leg-fpt",
      strategyCode: "turtle",
      fees: 1,
      barsHeld: 2,
    });
  });

  it("filters portfolio trades by exact symbol", () => {
    const rows = buildPortfolioTradeRows(modelWithTrades());

    expect(filterPortfolioTradeRows(rows, "BTC").map((row) => row.asset)).toEqual(["BTC"]);
    expect(filterPortfolioTradeRows(rows, "all")).toBe(rows);
  });

  it("selects only explicit finite aggregate KPIs", () => {
    const model = modelWithTrades();
    model.aggregate.metrics = {
      totalReturnPct: 12.5,
      maxDrawdownPct: -8.25,
      sharpe: 1.4,
      winRatePct: "60",
      profitFactor: Number.POSITIVE_INFINITY,
    };

    expect(buildBacktestKpis(model)).toEqual({
      totalReturnPct: 12.5,
      maxDrawdownPct: -8.25,
      sharpe: 1.4,
      winRatePct: null,
      profitFactor: null,
    });
  });

  it("reports which advanced artifact sections are available", () => {
    const model = modelWithTrades();
    model.aggregate.analytics = { sharpe: 1.4 };
    model.aggregate.reportHtml = "<html><body>QuantStats</body></html>";
    model.aggregate.contribution = [
      { timestamp: "2026-01-01T00:00:00Z", equity: 1000, components: { BTC: 500 } },
    ];
    model.aggregate.cashFlow = [
      {
        timestamp: "2026-01-02T00:00:00Z",
        type: "contribution",
        amount: 100,
        cashAmount: 50,
      },
    ];

    expect(advancedAnalysisAvailability(model)).toEqual({
      quantStats: true,
      contribution: true,
      cashFlowOrRebalance: true,
      perLeg: true,
    });
  });

  it("maps run status to a single output surface", () => {
    expect(backtestOutputState(null)).toBe("empty");
    expect(backtestOutputState("queued")).toBe("active");
    expect(backtestOutputState("running")).toBe("active");
    expect(backtestOutputState("failed")).toBe("failed");
    expect(backtestOutputState("succeeded")).toBe("results");
  });
});
