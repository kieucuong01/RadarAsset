import type { PortfolioResponse, WatchlistItemResponse } from "@/lib/backend/types";
import { getCachedPortfolio } from "@/lib/portfolio-client";
import { loadFavoriteAssets } from "@/lib/watchlist-client";

type WorkspaceDependencies = {
  loadWatchlist?: () => Promise<WatchlistItemResponse[]>;
  loadPortfolio?: () => Promise<PortfolioResponse>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Data source unavailable";
}

export async function loadSmartInsightsWorkspaceData(dependencies: WorkspaceDependencies = {}) {
  const watchlistPromise = (dependencies.loadWatchlist ?? loadFavoriteAssets)();
  const portfolioPromise = (dependencies.loadPortfolio ?? (() => getCachedPortfolio("1M")))();
  const [watchlistResult, portfolioResult] = await Promise.allSettled([
    watchlistPromise,
    portfolioPromise,
  ]);

  return {
    watchlist:
      watchlistResult.status === "fulfilled"
        ? { available: true as const, items: watchlistResult.value, error: null }
        : {
            available: false as const,
            items: [] as WatchlistItemResponse[],
            error: errorMessage(watchlistResult.reason),
          },
    portfolio:
      portfolioResult.status === "fulfilled"
        ? { available: true as const, value: portfolioResult.value, error: null }
        : {
            available: false as const,
            value: null as PortfolioResponse | null,
            error: errorMessage(portfolioResult.reason),
          },
  };
}
