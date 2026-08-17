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
  const YAxis = ({ tickFormatter }: { tickFormatter?: (value: number) => string }) => (
    <span>axis:{tickFormatter?.(100)}</span>
  );
  const Tooltip = ({ formatter }: { formatter?: (value: number) => unknown }) => (
    <span>tooltip:{String(formatter?.(102))}</span>
  );
  const AreaChart = ({ children }: { children?: React.ReactNode }) => {
    const items = Array.isArray(children) ? children : [children];
    return (
      <div>
        {items.filter(
          (child) =>
            child &&
            typeof child === "object" &&
            "type" in child &&
            (child.type === YAxis || child.type === Tooltip),
        )}
      </div>
    );
  };
  return {
    Area: Container,
    AreaChart,
    CartesianGrid: Container,
    Cell: Container,
    Legend: Container,
    Pie: Container,
    PieChart: Container,
    ResponsiveContainer: Container,
    Tooltip,
    XAxis: Container,
    YAxis,
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
        currency: "USDT",
      },
    ],
    transactions: [
      {
        id: "transaction-btc",
        createdAt: "2026-08-16T00:00:00.000Z",
        type: "buy",
        assetId: "asset-btc",
        symbol: "BTC",
        quantity: 1,
        price: 56_200_000,
        fee: 0,
        executedAt: "2026-08-16T00:00:00.000Z",
        note: null,
        grossAmount: 56_200_000,
        netAmount: -56_200_000,
        releasedCostBasis: 0,
        realizedPnL: 0,
        remainingQuantity: 1,
        currency: "USDT",
      },
    ],
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

    expect(text).toContain("portfolio.balance.total");
    expect(text).toContain("portfolio.allocation.title");
    expect(text).toContain("portfolio.performance.title");
    expect(text).toContain("portfolio.holdings.title");
    expect(text).toContain("portfolio.risk.title");
    expect(text).toContain("portfolio.transactions.title");
    expect(text).toContain("1,250,000 VND");
    expect(text).toContain("12,345.6789 BTC");
    expect(text).toContain("56,200,000 VND");
    expect(text).toContain("1,234,567 VND");
    expect(text).not.toContain("USDT");
    expect(text).not.toContain("common.fee-");
    expect(text).not.toContain("$1,250,000.00");
    state.portfolioMode = true;
    state.portfolioInjected = false;
    state.loadingInjected = false;
    const html = renderToStaticMarkup(<MockPortfolio />);
    expect(html).toContain('data-asset-icon="BTC"');
  });

  it("preserves an explicit USD portfolio when the UI locale is Vietnamese", () => {
    const text = renderPortfolio("USD");

    expect(text).toContain("56,200,000 USD");
    expect(text).toContain("+12.34%");
    expect(text).toContain("1.2346");
    expect(text).not.toContain("56.200.000");
  });

  it("formats strategy forward-test money with the explicit assignment currency", () => {
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
          currency: "USDT",
          snapshots: [
            {
              timestamp: "2026-08-16T00:00:00.000Z",
              equity: 2_500_000,
              benchmarkEquity: 2_400_000,
              pnlExcludingContributions: 1_250_000,
              cumulativeContributions: 500_000,
              cumulativeFees: 25,
            },
            {
              timestamp: "2026-08-17T00:00:00.000Z",
              equity: 2_550_000,
              benchmarkEquity: 2_424_000,
              pnlExcludingContributions: 1_300_000,
              cumulativeContributions: 500_000,
              cumulativeFees: 30,
            },
          ],
        },
      ],
    ];
    const text = textContent(
      renderToStaticMarkup(<PortfolioStrategyForwardTests currency="USD" />),
    );

    expect(text).toContain("1,300,000 USDT");
    expect(text).not.toContain("$1,250,000.00");
    expect(text).toContain("axis:100");
    expect(text).toContain("tooltip:102");
    expect(text).not.toContain("axis:100 USD");
    expect(text).not.toContain("tooltip:102 USD");
  });

  it("does not fabricate zero-valued forward metrics before the first snapshot", () => {
    state.arrayQueue = [
      [
        {
          assignmentId: "assignment-empty",
          portfolioId: "portfolio-formatting",
          symbol: "BTC",
          currency: "USDT",
          strategy: { code: "ma", version: "1", name: "MA", kind: "system" },
          status: "active",
          activatedAt: "2026-08-15T00:00:00.000Z",
          lastEvaluatedAt: null,
          lastEvaluatedBarAt: null,
          latestSignal: null,
          backtestBaseline: null,
          snapshots: [],
        },
      ],
    ];
    const text = textContent(renderToStaticMarkup(<PortfolioStrategyForwardTests />));

    expect(text).toContain("forwardTesting.pnlExContributions—");
    expect(text).toContain("forwardTesting.contributions—");
    expect(text).toContain("forwardTesting.fees—");
    expect(text).not.toContain("0 USDT");
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
          currency: "USDT",
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

    expect(text).toContain("56,200,000 USDT");
    expect(text).not.toContain("56.200.000");
  });
});
