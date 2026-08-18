import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPTIMIZER_FROM,
  DEFAULT_OPTIMIZER_METHOD,
  DEFAULT_OPTIMIZER_SYMBOLS,
  DEFAULT_OPTIMIZER_TO,
  buildOptimizerRequest,
} from "./optimizer-defaults";

describe("optimizer defaults", () => {
  it("uses the diversified VNINDEX, XAU, and BTC daily research window", () => {
    expect(DEFAULT_OPTIMIZER_SYMBOLS).toEqual(["VNINDEX", "XAU", "BTC"]);
    expect(DEFAULT_OPTIMIZER_FROM).toBe("2021-01-01");
    expect(DEFAULT_OPTIMIZER_TO).toBe("2026-01-01");
    expect(DEFAULT_OPTIMIZER_METHOD).toBe("risk_parity");
  });

  it("builds the default risk-parity request with the selected assets", () => {
    expect(
      buildOptimizerRequest({
        symbols: ["VNINDEX", "XAU", "BTC"],
        method: DEFAULT_OPTIMIZER_METHOD,
        from: DEFAULT_OPTIMIZER_FROM,
        to: DEFAULT_OPTIMIZER_TO,
        maxWeightPct: 70,
      }),
    ).toEqual({
      symbols: ["VNINDEX", "XAU", "BTC"],
      method: "risk_parity",
      timeframe: "1d",
      from: "2021-01-01",
      to: "2026-01-01",
      maxWeightBps: 7000,
      totalWeightBps: 10_000,
      dividendMode: "exclude",
    });
  });
});
