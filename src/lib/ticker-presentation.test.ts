import { describe, expect, it } from "vitest";

import type { MarketTickerResponse } from "./backend/types";
import {
  CURATED_TICKER_SYMBOLS,
  curatedTickerUrl,
  resolveCuratedTickerSnapshot,
  resolveTickerSnapshot,
} from "./ticker-presentation";

function row(
  symbol: string,
  assetClass: MarketTickerResponse["assetClass"] = "equity",
): MarketTickerResponse {
  return {
    symbol,
    name: symbol,
    assetClass,
    price: 100,
    changePercent: 1,
    volume: 10,
    ts: "2026-08-14T00:00:00.000Z",
  };
}

describe("ticker presentation", () => {
  it("marks a non-empty API result as system data", () => {
    const rows = [{ sym: "ETH", price: 3_512, chg: 1.8 }];

    expect(resolveTickerSnapshot(rows)).toEqual({
      rows,
      status: "SYSTEM",
      detail: "Được tải từ /api/market/ticker.",
    });
  });

  it("fails closed when the API returns no rows", () => {
    expect(resolveTickerSnapshot([])).toEqual({
      rows: [],
      status: "UNAVAILABLE",
      detail: "Ticker API không có dữ liệu đã xác thực.",
    });
  });

  it("defines the approved fixed universe in display order", () => {
    expect(CURATED_TICKER_SYMBOLS).toEqual([
      "VIC",
      "VCB",
      "BID",
      "CTG",
      "TCB",
      "VPB",
      "FPT",
      "HPG",
      "VNM",
      "GAS",
      "BTC",
      "ETH",
      "BNB",
      "XRP",
      "SOL",
      "ADA",
      "TRX",
      "LINK",
      "LTC",
      "AVAX",
      "XAU",
    ]);
  });

  it("requests and renders only approved symbols in approved order", () => {
    const snapshot = resolveCuratedTickerSnapshot([
      row("ETH", "crypto"),
      row("GOLD", "commodity"),
      row("VIC"),
      row("BTC", "crypto"),
      row("TSLA"),
      row("XAU", "commodity"),
    ]);

    expect(snapshot.rows.map((item) => item.symbol)).toEqual(["VIC", "BTC", "ETH", "XAU"]);
    expect(snapshot.missingSymbols).toHaveLength(17);
    expect(curatedTickerUrl()).toBe(
      `/api/market/ticker?symbols=${encodeURIComponent(CURATED_TICKER_SYMBOLS.join(","))}`,
    );
  });

  it("does not fabricate missing approved rows", () => {
    const btc = row("BTC", "crypto");
    const snapshot = resolveCuratedTickerSnapshot([btc]);

    expect(snapshot.rows).toEqual([btc]);
    expect(snapshot.status).toBe("SYSTEM");
    expect(snapshot.detail).toContain("Thiếu 20 mã");
  });
});
