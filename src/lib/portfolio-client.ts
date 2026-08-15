import type { PortfolioResponse, PortfolioTimeframe } from "@/lib/backend/types";
import { cachedRequest, clearCachedRequests } from "@/lib/client/request-cache";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type PortfolioFetchResponse = PortfolioResponse;

function portfolioCacheKey(timeframe: PortfolioTimeframe) {
  return `portfolio:${timeframe}`;
}

export async function getPortfolio(
  timeframe: PortfolioTimeframe,
  fetcher: Fetcher = fetch,
): Promise<PortfolioResponse> {
  const response = await fetcher(`/api/portfolio?timeframe=${timeframe}`, { cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Portfolio API unavailable");
  }
  return (await response.json()) as PortfolioResponse;
}

export function getCachedPortfolio(
  timeframe: PortfolioTimeframe,
  fetcher: Fetcher = fetch,
): Promise<PortfolioResponse> {
  return cachedRequest(portfolioCacheKey(timeframe), () => getPortfolio(timeframe, fetcher));
}

export function clearCachedPortfolio() {
  clearCachedRequests("portfolio:");
}
