import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { MarketTickerResponse } from "@/lib/backend/types";
import * as tickerPresentation from "@/lib/ticker-presentation";

function row(symbol: string, assetClass: MarketTickerResponse["assetClass"]): MarketTickerResponse {
  return {
    symbol,
    name: symbol,
    assetClass,
    price: 1,
    changePercent: 0,
    volume: null,
    ts: "2026-08-16T00:00:00.000Z",
  };
}

describe("TickerTape", () => {
  const source = readFileSync(join(process.cwd(), "src", "components", "TickerTape.tsx"), "utf8");

  it("uses the curated endpoint and slow transform-only marquee", () => {
    expect(source).toContain("curatedTickerUrl()");
    expect(source).toContain("resolveCuratedTickerSnapshot");
    expect(source).toContain("animation: ticker-scroll 160s linear infinite");
    expect(source).toContain("min-w-0 flex-1 overflow-hidden");
    expect(source).toContain("animation-play-state: paused");
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).not.toContain("ticker-scroll 60s");
  });

  it("maps the fixed ticker universe to deterministic quote currencies", () => {
    const tickerQuoteCurrency = (
      tickerPresentation as unknown as {
        tickerQuoteCurrency?: (tick: MarketTickerResponse) => string;
      }
    ).tickerQuoteCurrency;

    expect(tickerQuoteCurrency).toBeTypeOf("function");
    if (!tickerQuoteCurrency) return;

    expect(tickerQuoteCurrency(row("VIC", "equity"))).toBe("VND");
    expect(tickerQuoteCurrency(row("BTC", "crypto"))).toBe("USDT");
    expect(tickerQuoteCurrency(row("XAU", "commodity"))).toBe("USD");
  });
});
