import { describe, expect, it, vi } from "vitest";

import {
  clearCachedPortfolio,
  getCachedPortfolio,
  getPortfolio,
  type PortfolioFetchResponse,
} from "./portfolio-client";

const portfolio = {
  portfolioId: "portfolio-a",
  portfolioName: "Mock Portfolio",
  baseCurrency: "USD",
  totalValue: 100,
  totalCost: 90,
  unrealizedPnL: 10,
  realizedPnL: 0,
  totalPnL: 10,
  totalPnLPct: 11.11,
  cumulativeBuyCapital: 90,
  dayChangePct: 1,
  allocation: [],
  holdings: [],
  transactions: [],
  performance: [],
  riskMetrics: [],
  dataAsOf: "2026-08-15T00:00:00.000Z",
  dataSource: "local",
} satisfies PortfolioFetchResponse;

describe("portfolio client", () => {
  it("loads a portfolio timeframe without caching by default", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(portfolio)));

    await expect(getPortfolio("1M", fetcher)).resolves.toEqual(portfolio);

    expect(fetcher).toHaveBeenCalledWith("/api/portfolio?timeframe=1M", { cache: "no-store" });
  });

  it("deduplicates cached portfolio requests by timeframe", async () => {
    clearCachedPortfolio();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(portfolio)));

    const [first, second] = await Promise.all([
      getCachedPortfolio("1M", fetcher),
      getCachedPortfolio("1M", fetcher),
    ]);

    expect(first).toEqual(portfolio);
    expect(second).toEqual(portfolio);
    expect(fetcher).toHaveBeenCalledTimes(1);

    clearCachedPortfolio();
  });
});
