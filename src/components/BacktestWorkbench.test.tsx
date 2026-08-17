import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BacktestLegCard } from "@/components/BacktestLegCard";
import { ActiveBacktestPortfolio } from "@/components/backtest-results/ActiveBacktestPortfolio";
import { BacktestKpiGrid } from "@/components/backtest-results/BacktestKpiGrid";
import { BacktestTradeList } from "@/components/backtest-results/BacktestTradeList";
import type { DraftBacktestLeg } from "@/lib/backtest/builder-state";
import type { BacktestRun } from "@/lib/backtest/client";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import { I18nProvider } from "@/lib/i18n/provider";

import { BacktestWorkbench } from "./BacktestWorkbench";

function textContent(html: string): string {
  return html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
}

const leg = {
  symbol: "BTC",
  name: "Bitcoin",
  market: "crypto_spot",
  venue: "BINANCE",
  currency: "USD",
  maxLeverage: 2,
  timeframe: "1d",
  datasetVersionId: "dataset-btc",
  coverageStart: "2025-01-01T00:00:00.000Z",
  coverageEnd: "2026-01-01T00:00:00.000Z",
  rowCount: 12_450,
  freshness: "fresh",
  backtestable: true,
  reasonCode: null,
  listingStatus: "active",
  availableAdjustments: ["raw", "total_return"],
  calendarVersion: "crypto-24x7-v1",
  qualityIssueCount: 0,
  blockingQualityIssueCount: 0,
  catalogCoverage: {
    firstObservedAt: "2025-01-01T00:00:00.000Z",
    completeForRequestedRange: true,
    warningCode: null,
  },
  allocationBps: 5_000,
  leverage: 1,
  strategyCode: "ma_crossover",
  strategyVersion: "1.0.0",
  strategyName: "MA Crossover",
  strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
  strategyParameterSchema: [],
  supportedMarkets: ["crypto_spot"],
  supportedTimeframes: ["1d"],
} satisfies DraftBacktestLeg;

const model = {
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
    robustness: null,
    historicalCoverage: null,
  },
  legs: [
    {
      id: "leg-btc",
      symbol: "BTC",
      currency: "USDT",
      label: "BTC · MA Crossover",
      allocationBps: 10_000,
      initialNotional: 56_200.25,
      strategyCode: "ma_crossover",
      strategyVersion: "1.0.0",
      strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
      datasetVersionId: "dataset-btc",
      metrics: {},
      equity: [],
      drawdown: [],
      trades: [
        {
          asset: "BTC",
          side: "long",
          entrySignalAt: "2026-01-01T00:00:00Z",
          entryAt: "2026-01-02T00:00:00Z",
          exitSignalAt: "2026-01-03T00:00:00Z",
          exitAt: "2026-01-04T00:00:00Z",
          entryPrice: 56_000,
          exitPrice: 56_200.256,
          quantity: 1.23456789,
          fees: 1.25,
          slippageCost: 0.5,
          realizedPnl: -12.35,
          returnPct: -12.35,
          barsHeld: 2,
          exitReason: "signal",
        },
      ],
    },
  ],
} satisfies BacktestResultModel;

const run = {
  timeframe: "1d",
  legs: [
    {
      id: "leg-btc",
      strategyName: "MA Crossover",
      leverage: 1,
    },
  ],
} as BacktestRun;

describe("BacktestWorkbench", () => {
  it("renders the original-style backtest shell with configuration and output regions", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <BacktestWorkbench />
      </I18nProvider>,
    );

    expect(html).toContain('aria-label="Cấu hình backtest"');
    expect(html).toContain('aria-label="Kết quả backtest"');
    expect(html).toContain("Danh mục đang chạy");
    expect(html).toContain("Đường vốn &amp; sụt giảm");
    expect(html).toContain("Danh sách lệnh");
    expect(html).toContain("Tổng vốn");
    expect(html).toContain("Chế độ phân bổ");
    expect(html).toContain("Trọng số tiền mặt (%)");
    expect(html).toContain("Góp vốn hàng tháng");
    expect(html).toContain("Chưa thể chạy kiểm định");
    expect(html).toContain("Chạy kiểm định danh mục");
  });

  it("initializes builder state lazily from the active locale", () => {
    const source = readFileSync(resolve("src/components/PortfolioBacktestBuilder.tsx"), "utf8");

    expect(source).toMatch(
      /useReducer\(\s*reduceBuilder,\s*locale,\s*createInitialBuilderStateForLocale,?\s*\)/,
    );
  });

  it("formats builder notional and row count without overriding the explicit base currency", () => {
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <BacktestLegCard
            leg={leg}
            strategies={[]}
            timeframe="1d"
            totalCapital={2_500_000}
            baseCurrency="VND"
            dispatch={() => undefined}
          />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("1,250,000 VND");
    expect(text).toContain("12,450 phiên");
    expect(text).not.toContain("1,250,000 USD");
  });

  it("formats result notional and trades with full numeric precision rules", () => {
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <ActiveBacktestPortfolio run={run} model={model} />
          <BacktestTradeList model={model} currency="USD" />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("56,200.25 USD");
    expect(text).toContain("56,200.26 USDT");
    expect(text).toContain("1.23456789");
    expect(text).toContain("1.25 USD");
    expect(text).toContain("−12.35%");
  });

  it("rounds VND execution prices while fees and P&L stay in the base currency", () => {
    const vndModel = {
      ...model,
      legs: [
        {
          ...model.legs[0],
          id: "leg-vnm",
          symbol: "VNM",
          currency: "VND",
          trades: [
            {
              ...model.legs[0].trades[0],
              asset: "VNM",
              entryPrice: 123_456.78,
              exitPrice: 123_456.78,
            },
          ],
        },
      ],
    } satisfies BacktestResultModel;
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <BacktestTradeList model={vndModel} currency="USD" />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("123,457 VND");
    expect(text).not.toContain("123,456.78");
    expect(text).toContain("1.25 USD");
    expect(text).toContain("−12.35 USD");
  });

  it("formats backtest KPI percentages and ratios with shared precision", () => {
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <BacktestKpiGrid
            model={{
              ...model,
              aggregate: {
                ...model.aggregate,
                metrics: { maxDrawdownPct: -12.35, sharpe: 1.234567 },
              },
            }}
          />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("−12.35%");
    expect(text).toContain("1.2346");
  });
});
