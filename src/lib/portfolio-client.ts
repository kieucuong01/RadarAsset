import type {
  PortfolioResponse,
  PortfolioTimeframe,
  PortfolioTransactionCreateInput,
  PortfolioTransactionUpdateInput,
} from "@/lib/backend/types";
import type { PortfolioCurrency } from "@/lib/backend/fx-rates";
import { cachedRequest, clearCachedRequests } from "@/lib/client/request-cache";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type PortfolioFetchResponse = PortfolioResponse;

function portfolioCacheKey(timeframe: PortfolioTimeframe, currency: PortfolioCurrency) {
  return `portfolio:${timeframe}:${currency}`;
}

export async function getPortfolio(
  timeframe: PortfolioTimeframe,
  currency: PortfolioCurrency = "USD",
  fetcher: Fetcher = fetch,
): Promise<PortfolioResponse> {
  const response = await fetcher(`/api/portfolio?timeframe=${timeframe}&currency=${currency}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Portfolio API unavailable");
  }
  return (await response.json()) as PortfolioResponse;
}

export function getCachedPortfolio(
  timeframe: PortfolioTimeframe,
  currency: PortfolioCurrency = "USD",
  fetcher: Fetcher = fetch,
): Promise<PortfolioResponse> {
  return cachedRequest(portfolioCacheKey(timeframe, currency), () =>
    getPortfolio(timeframe, currency, fetcher),
  );
}

async function portfolioMutation(
  url: string,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<PortfolioResponse> {
  const response = await fetcher(url, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Portfolio transaction could not be saved");
  }
  clearCachedPortfolio();
  return (await response.json()) as PortfolioResponse;
}

export function createPortfolioTransactionRequest(
  input: PortfolioTransactionCreateInput,
  fetcher: Fetcher = fetch,
) {
  return portfolioMutation(
    "/api/portfolio/transactions",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    fetcher,
  );
}

export function updatePortfolioTransactionRequest(
  id: string,
  input: PortfolioTransactionUpdateInput,
  fetcher: Fetcher = fetch,
) {
  return portfolioMutation(
    `/api/portfolio/transactions/${id}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    fetcher,
  );
}

export function deletePortfolioTransactionRequest(
  id: string,
  timeframe: PortfolioTimeframe,
  currency: PortfolioCurrency,
  fetcher: Fetcher = fetch,
) {
  return portfolioMutation(
    `/api/portfolio/transactions/${id}?timeframe=${timeframe}&currency=${currency}`,
    { method: "DELETE" },
    fetcher,
  );
}

export function clearCachedPortfolio() {
  clearCachedRequests("portfolio:");
}
