import type { DataStatus } from "@/lib/mvp-ui";
import type { MarketTickerResponse } from "@/lib/backend/types";

export const CURATED_TICKER_GROUPS = {
  vietnam: ["VIC", "VCB", "BID", "CTG", "TCB", "VPB", "FPT", "HPG", "VNM", "GAS"],
  crypto: ["BTC", "ETH", "BNB", "XRP", "SOL", "ADA", "TRX", "LINK", "LTC", "AVAX"],
  gold: ["XAU"],
} as const;

export const CURATED_TICKER_SYMBOLS = [
  ...CURATED_TICKER_GROUPS.vietnam,
  ...CURATED_TICKER_GROUPS.crypto,
  ...CURATED_TICKER_GROUPS.gold,
] as const;

export type TickerSnapshot<T> = {
  rows: T[];
  status: Extract<DataStatus, "SYSTEM" | "UNAVAILABLE">;
  detail: string;
};

export function resolveTickerSnapshot<T>(rows: T[]): TickerSnapshot<T> {
  if (rows.length === 0) {
    return {
      rows: [],
      status: "UNAVAILABLE",
      detail: "Ticker API không có dữ liệu đã xác thực.",
    };
  }

  return {
    rows,
    status: "SYSTEM",
    detail: "Được tải từ /api/market/ticker.",
  };
}

export function curatedTickerUrl(): string {
  return `/api/market/ticker?symbols=${encodeURIComponent(CURATED_TICKER_SYMBOLS.join(","))}`;
}

export function resolveCuratedTickerSnapshot(
  rows: MarketTickerResponse[],
): TickerSnapshot<MarketTickerResponse> & { missingSymbols: string[] } {
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  const orderedRows = CURATED_TICKER_SYMBOLS.flatMap((symbol) => {
    const row = bySymbol.get(symbol);
    return row ? [row] : [];
  });
  const missingSymbols = CURATED_TICKER_SYMBOLS.filter((symbol) => !bySymbol.has(symbol));
  const snapshot = resolveTickerSnapshot(orderedRows);

  return {
    ...snapshot,
    missingSymbols,
    detail:
      orderedRows.length > 0 && missingSymbols.length > 0
        ? `Được tải từ /api/market/ticker. Thiếu ${missingSymbols.length} mã: ${missingSymbols.join(", ")}.`
        : snapshot.detail,
  };
}
