import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PortfolioResponse } from "@/lib/backend/types";

const state = vi.hoisted(() => ({
  portfolio: null as PortfolioResponse | null,
  portfolioMode: false,
  portfolioInjected: false,
  loadingInjected: false,
  arrayQueue: [] as unknown[][],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const resolved = typeof initial === "function" ? (initial as () => T)() : initial;
      if (Array.isArray(resolved) && resolved.length === 0 && state.arrayQueue.length > 0) {
        return actual.useState(state.arrayQueue.shift() as T);
      }
      if (state.portfolioMode && resolved === null && !state.portfolioInjected) {
        state.portfolioInjected = true;
        return actual.useState(state.portfolio as T);
      }
      if (resolved === true && state.portfolioInjected && !state.loadingInjected) {
        state.loadingInjected = true;
        return actual.useState(false as T);
      }
      return actual.useState(initial);
    },
  };
});

vi.mock("recharts", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Area: Container,
    AreaChart: Container,
    CartesianGrid: Container,
    Cell: Container,
    Legend: Container,
    Pie: Container,
    PieChart: Container,
    ResponsiveContainer: () => null,
    Tooltip: Container,
    XAxis: Container,
    YAxis: Container,
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/i18n/context", () => ({
  useI18n: () => ({
    locale: "vi" as const,
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/PortfolioTransactionDialog", () => ({
  PortfolioTransactionDialog: () => null,
}));

import { FavoriteAssetsPanel } from "./FavoriteAssetsPanel";
import { MockPortfolio } from "./MockPortfolio";
import { PortfolioStrategyForwardTests } from "./PortfolioStrategyForwardTests";
import { StrategyAssignmentPanel } from "./StrategyAssignmentPanel";

function portfolio(baseCurrency: string): PortfolioResponse {
  return {
    portfolioId: "portfolio-formatting",
    portfolioName: "Formatting Portfolio",
    baseCurrency,
    totalValue: 1_250_000,
    totalCost: 1_100_000,
    unrealizedPnL: 100_000,
    realizedPnL: 50_000,
    totalPnL: 150_000,
    totalPnLPct: 12.34,
    cumulativeBuyCapital: 1_215_559,
    dayChangePct: 12.34,
    allocation: [{ category: "Crypto", value: 100 }],
    holdings: [
      {
        assetId: "asset-btc",
        ticker: "BTC",
        name: "Bitcoin",
        qty: 12_345.6789,
        price: 56_200_000,
        cost: 55_000_000,
        value: 1_250_000,
        pnl: 150_000,
        pnlPct: 12.34,
        alloc: 100,
        sentiment: "Bullish",
        category: "Crypto",
      },
    ],
    transactions: [],
    performance: [],
    riskMetrics: [
      {
        key: "var95",
        label: "VaR 95% (1D)",
        value: "$1,234,567",
        rawValue: 1_234_567,
        sub: "Historical method",
        tone: "bear",
      },
      {
        key: "beta",
        label: "Beta (vs VNINDEX)",
        value: "1.234568",
        rawValue: 1.234568,
        sub: "Market-like",
        tone: "primary",
      },
    ],
    dataAsOf: null,
    dataSource: "local",
  };
}

function textContent(html: string): string {
  return html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
}

function renderPortfolio(baseCurrency: string): string {
  state.portfolio = portfolio(baseCurrency);
  state.portfolioMode = true;
  state.portfolioInjected = false;
  state.loadingInjected = false;
  state.arrayQueue = [];
  return textContent(renderToStaticMarkup(<MockPortfolio />));
}

describe("Portfolio number formatting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.portfolioMode = false;
    state.arrayQueue = [];
  });

  it("uses the explicit portfolio currency for totals, holdings, and risk money", () => {
    const text = renderPortfolio("VND");

    expect(text).toContain("1,250,000 VND");
    expect(text).toContain("12,345.6789 BTC");
    expect(text).toContain("56,200,000 VND");
    expect(text).toContain("1,234,567 VND");
    expect(text).not.toContain("$1,250,000.00");
  });

  it("preserves an explicit USD portfolio when the UI locale is Vietnamese", () => {
    const text = renderPortfolio("USD");

    expect(text).toContain("56,200,000 USD");
    expect(text).toContain("+12.34%");
    expect(text).toContain("1.2346");
    expect(text).not.toContain("56.200.000");
  });

  it("formats unspecified favorite prices with the Vietnamese monetary default", () => {
    state.arrayQueue = [
      [
        {
          id: "favorite-btc",
          sym: "BTC",
          name: "Bitcoin",
          price: 56_200_000,
          chg: 12.34,
          alert: 0,
          sentiment: "bull",
          datasetState: "ready",
          ingestionRequestId: null,
          backtestableTimeframes: ["1d"],
        },
      ],
    ];
    const text = textContent(
      renderToStaticMarkup(
        <FavoriteAssetsPanel
          holdings={[]}
          timeframe="1M"
          onRecorded={() => undefined}
          portfolioCurrency="USD"
        />,
      ),
    );

    expect(text).toContain("56,200,000 VND");
    expect(text).toContain("+12.34%");
  });

  it("formats strategy forward-test money with the explicit portfolio currency", () => {
    state.arrayQueue = [
      [
        {
          assignmentId: "assignment-1",
          portfolioId: "portfolio-formatting",
          symbol: "BTC",
          strategy: { code: "ma", version: "1", name: "MA", kind: "system" },
          status: "active",
          activatedAt: "2026-08-15T00:00:00.000Z",
          lastEvaluatedAt: null,
          lastEvaluatedBarAt: null,
          latestSignal: null,
          backtestBaseline: null,
          snapshots: [
            {
              timestamp: "2026-08-16T00:00:00.000Z",
              equity: 2_500_000,
              benchmarkEquity: 2_400_000,
              pnlExcludingContributions: 1_250_000,
              cumulativeContributions: 500_000,
              cumulativeFees: 25,
            },
          ],
        },
      ],
    ];
    const text = textContent(
      renderToStaticMarkup(<PortfolioStrategyForwardTests currency="USD" />),
    );

    expect(text).toContain("1,250,000 USD");
    expect(text).not.toContain("$1,250,000.00");
  });

  it("formats strategy signal prices with the explicit portfolio currency", () => {
    state.arrayQueue = [
      [],
      [
        {
          id: "assignment-1",
          portfolioId: "portfolio-formatting",
          symbol: "BTC",
          strategyCode: "ma",
          strategyVersion: "1",
          strategyName: "MA",
          parameters: {},
          status: "active",
          signals: [
            {
              id: "signal-1",
              assignmentId: "assignment-1",
              assetId: "asset-btc",
              symbol: "BTC",
              strategyCode: "ma",
              strategyVersion: "1",
              signalType: "buy",
              status: "reviewed",
              signalAt: "2026-08-16T00:00:00.000Z",
              executionAt: null,
              signalPrice: 56_200_000,
              reason: "Breakout",
              metadata: {},
            },
          ],
        },
      ],
    ];
    const text = textContent(
      renderToStaticMarkup(
        <StrategyAssignmentPanel
          holdings={[]}
          disabled={false}
          timeframe="1M"
          onRecorded={() => undefined}
          portfolioCurrency="USD"
        />,
      ),
    );

    expect(text).toContain("56,200,000 USD");
    expect(text).not.toContain("56.200.000");
  });
});
