import type { PortfolioHoldingResponse, WatchlistItemResponse } from "@/lib/backend/types";
import { favoriteActionState } from "@/lib/favorite-assets/state";
import type { AssetOpinionModel } from "@/lib/smart-insights-client";

const MAX_VISIBLE_ASSETS = 25;

const DEFAULT_REPRESENTATIVES = [
  { symbol: "BTC", name: "Bitcoin", currency: "USDT" },
  { symbol: "ETH", name: "Ethereum", currency: "USDT" },
  { symbol: "VNINDEX", name: "VN-Index", currency: "VND" },
  { symbol: "VN30", name: "VN30 Index", currency: "VND" },
  { symbol: "XAU", name: "Gold Spot", currency: "USD" },
] as const;

const DEFAULT_BY_SYMBOL = new Map<string, (typeof DEFAULT_REPRESENTATIVES)[number]>(
  DEFAULT_REPRESENTATIVES.map((item) => [item.symbol, item]),
);

export type AssetOpinionWorkspaceItem = {
  symbol: string;
  name: string;
  opinion: AssetOpinionModel | null;
  watchlistItem: WatchlistItemResponse | null;
  holding: PortfolioHoldingResponse | null;
  price: number | null;
  currency: string | null;
  datasetState: WatchlistItemResponse["datasetState"] | null;
  isDefaultRepresentative: boolean;
  canRemove: boolean;
  canSell: boolean;
  backtestHref: string | null;
};

type AssetOpinionWorkspaceInput = {
  opinions: AssetOpinionModel[];
  watchlist: WatchlistItemResponse[];
  holdings: PortfolioHoldingResponse[];
  watchlistAvailable: boolean;
  portfolioAvailable: boolean;
};

function canonicalSymbol(input: string): string {
  return input.trim().toUpperCase();
}

function keyedBySymbol<T>(items: T[], symbolOf: (item: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const symbol = canonicalSymbol(symbolOf(item));
    if (symbol && !result.has(symbol)) result.set(symbol, item);
  }
  return result;
}

function uniqueSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const input of symbols) {
    const symbol = canonicalSymbol(input);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    result.push(symbol);
  }
  return result;
}

function visibleSymbols(input: AssetOpinionWorkspaceInput): string[] {
  const candidates = uniqueSymbols([
    ...input.holdings.map((item) => item.ticker),
    ...input.watchlist.map((item) => item.sym),
    ...DEFAULT_REPRESENTATIVES.map((item) => item.symbol),
    ...(input.watchlistAvailable && input.portfolioAvailable
      ? []
      : input.opinions.map((item) => item.symbol)),
  ]);
  const nonDefaultLimit = MAX_VISIBLE_ASSETS - DEFAULT_REPRESENTATIVES.length;
  let nonDefaultCount = 0;
  return candidates.filter((symbol) => {
    if (DEFAULT_BY_SYMBOL.has(symbol)) return true;
    if (nonDefaultCount >= nonDefaultLimit) return false;
    nonDefaultCount += 1;
    return true;
  });
}

export function buildAssetOpinionWorkspace(
  input: AssetOpinionWorkspaceInput,
): AssetOpinionWorkspaceItem[] {
  const opinions = keyedBySymbol(input.opinions, (item) => item.symbol);
  const watchlist = keyedBySymbol(input.watchlist, (item) => item.sym);
  const holdings = keyedBySymbol(input.holdings, (item) => item.ticker);

  return visibleSymbols(input).map((symbol) => {
    const opinion = opinions.get(symbol) ?? null;
    const watchlistItem = watchlist.get(symbol) ?? null;
    const holding = holdings.get(symbol) ?? null;
    const representative = DEFAULT_BY_SYMBOL.get(symbol) ?? null;
    const hasWatchlistQuote = Boolean(
      watchlistItem &&
      (watchlistItem.hasMarketQuote ?? watchlistItem.price > 0) &&
      Number.isFinite(watchlistItem.price) &&
      watchlistItem.price > 0,
    );
    const price =
      holding && Number.isFinite(holding.price) && holding.price > 0
        ? holding.price
        : hasWatchlistQuote
          ? (watchlistItem?.price ?? null)
          : null;
    const backtestHref = watchlistItem ? favoriteActionState(watchlistItem).backtestHref : null;

    return {
      symbol,
      name:
        holding?.name ??
        watchlistItem?.name ??
        opinion?.assetName ??
        representative?.name ??
        symbol,
      opinion,
      watchlistItem,
      holding,
      price,
      currency: holding?.currency ?? watchlistItem?.currency ?? representative?.currency ?? null,
      datasetState: watchlistItem?.datasetState ?? null,
      isDefaultRepresentative: Boolean(representative),
      canRemove: Boolean(input.watchlistAvailable && watchlistItem && !holding),
      canSell: Boolean(input.portfolioAvailable && holding && holding.qty > 0),
      backtestHref,
    };
  });
}
