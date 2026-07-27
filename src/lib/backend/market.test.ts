import { describe, expect, it } from "vitest";

import { buildTickerResponse } from "./market";
import type { MarketBarInput } from "./types";

describe("market backend domain", () => {
  it("uses the latest two bars to calculate price and percent change", () => {
    const bars: MarketBarInput[] = [
      {
        symbol: "BTC",
        name: "Bitcoin",
        assetClass: "crypto",
        ts: "2026-06-11T00:00:00.000Z",
        close: 65000,
        volume: 100,
      },
      {
        symbol: "BTC",
        name: "Bitcoin",
        assetClass: "crypto",
        ts: "2026-06-12T00:00:00.000Z",
        close: 66000,
        volume: 100,
      },
      {
        symbol: "BTC",
        name: "Bitcoin",
        assetClass: "crypto",
        ts: "2026-06-13T00:00:00.000Z",
        close: 67420,
        volume: 100,
      },
    ];

    const [ticker] = buildTickerResponse(bars);

    expect(ticker).toMatchObject({
      symbol: "BTC",
      name: "Bitcoin",
      assetClass: "crypto",
      price: 67420,
    });
    expect(ticker.changePercent).toBeCloseTo(2.1515, 4);
  });
});
