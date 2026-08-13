import { describe, expect, it } from "vitest";

import { resolveTickerSnapshot } from "./ticker-presentation";

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
});
