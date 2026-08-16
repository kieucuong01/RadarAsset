import { describe, expect, it, vi } from "vitest";

import type { PortfolioResponse, WatchlistItemResponse } from "@/lib/backend/types";

import { loadSmartInsightsWorkspaceData } from "./smart-insights-workspace-client";

const watchlist: WatchlistItemResponse[] = [
  {
    id: "watch-eth",
    sym: "ETH",
    name: "Ethereum",
    price: 3_500,
    chg: 1,
    alert: 0,
    sentiment: "neutral",
    datasetState: "ready",
    ingestionRequestId: null,
    backtestableTimeframes: ["1d"],
    currency: "USDT",
    hasMarketQuote: true,
  },
];

const portfolio: PortfolioResponse = {
  portfolioId: "portfolio-a",
  portfolioName: "Mock Portfolio",
  baseCurrency: "VND",
  totalValue: 0,
  totalCost: 0,
  unrealizedPnL: 0,
  realizedPnL: 0,
  totalPnL: 0,
  totalPnLPct: 0,
  cumulativeBuyCapital: 0,
  dayChangePct: 0,
  allocation: [],
  holdings: [],
  transactions: [],
  performance: [],
  riskMetrics: [],
  dataAsOf: null,
  dataSource: "local",
};

describe("loadSmartInsightsWorkspaceData", () => {
  it("starts the independent watchlist and portfolio reads together", async () => {
    const order: string[] = [];
    const loadWatchlist = vi.fn(async () => {
      order.push("watchlist-start");
      await Promise.resolve();
      order.push("watchlist-end");
      return watchlist;
    });
    const loadPortfolio = vi.fn(async () => {
      order.push("portfolio-start");
      await Promise.resolve();
      order.push("portfolio-end");
      return portfolio;
    });

    const result = await loadSmartInsightsWorkspaceData({ loadWatchlist, loadPortfolio });

    expect(order.slice(0, 2)).toEqual(["watchlist-start", "portfolio-start"]);
    expect(loadWatchlist).toHaveBeenCalledTimes(1);
    expect(loadPortfolio).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      watchlist: { available: true, items: watchlist, error: null },
      portfolio: { available: true, value: portfolio, error: null },
    });
  });

  it("isolates one failed source without discarding the other", async () => {
    const result = await loadSmartInsightsWorkspaceData({
      loadWatchlist: async () => {
        throw new Error("watchlist unavailable");
      },
      loadPortfolio: async () => portfolio,
    });

    expect(result.watchlist).toEqual({
      available: false,
      items: [],
      error: "watchlist unavailable",
    });
    expect(result.portfolio).toEqual({ available: true, value: portfolio, error: null });
  });

  it("does not surface personal watchlist errors for unauthenticated guest mode", async () => {
    const result = await loadSmartInsightsWorkspaceData({
      loadWatchlist: async () => {
        throw new Error("Không thể tải danh sách tài sản yêu thích.");
      },
      loadPortfolio: async () => {
        throw new Error("Authentication required.");
      },
    });

    expect(result.watchlist).toEqual({
      available: false,
      items: [],
      error: null,
    });
    expect(result.portfolio).toEqual({
      available: false,
      value: null,
      error: "Authentication required.",
    });
  });
});
