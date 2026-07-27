import type { MarketBarInput, MarketTickerResponse } from "./types";

function round(value: number, digits = 4) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function buildTickerResponse(bars: MarketBarInput[]): MarketTickerResponse[] {
  const bySymbol = new Map<string, MarketBarInput[]>();

  for (const bar of bars) {
    bySymbol.set(bar.symbol, [...(bySymbol.get(bar.symbol) ?? []), bar]);
  }

  return Array.from(bySymbol.entries()).map(([symbol, symbolBars]) => {
    const sorted = [...symbolBars].sort((a, b) => a.ts.localeCompare(b.ts));
    const latest = sorted[sorted.length - 1];
    const previous = sorted[sorted.length - 2] ?? latest;
    const changePercent =
      previous.close === 0 ? 0 : ((latest.close - previous.close) / previous.close) * 100;

    return {
      symbol,
      name: latest.name,
      assetClass: latest.assetClass,
      price: latest.close,
      changePercent: round(changePercent),
      volume: latest.volume,
      ts: latest.ts,
    };
  });
}
