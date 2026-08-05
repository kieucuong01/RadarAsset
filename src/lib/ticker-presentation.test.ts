import { describe, expect, it } from "vitest";

import { resolveTickerSnapshot } from "./ticker-presentation";

const fallback = [{ sym: "BTC", price: 67_420, chg: 2.5 }];

describe("ticker presentation", () => {
  it("marks a non-empty API result as system data", () => {
    const rows = [{ sym: "ETH", price: 3_512, chg: 1.8 }];

    expect(resolveTickerSnapshot(rows, fallback)).toEqual({
      rows,
      status: "SYSTEM",
      detail: "Được tải từ /api/market/ticker.",
    });
  });

  it("keeps the clearly labeled fallback when the API returns no rows", () => {
    expect(resolveTickerSnapshot([], fallback)).toEqual({
      rows: fallback,
      status: "SAMPLE",
      detail: "Ticker API không có dữ liệu; đang hiển thị dữ liệu mẫu.",
    });
  });
});
