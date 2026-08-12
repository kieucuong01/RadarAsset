import { describe, expect, it } from "vitest";

import {
  initialQuantLabTab,
  normalizeBacktestStrategyPreset,
  normalizePreselectedSymbols,
  normalizeQuantLabTab,
} from "./preselection";

describe("Quant Lab URL preselection", () => {
  it("normalizes comma-separated and repeated values without fixed defaults", () => {
    expect(normalizePreselectedSymbols([" btc, VNM ", "xau", "BTC"])).toEqual([
      "BTC",
      "VNM",
      "XAU",
    ]);
  });

  it("drops invalid symbols and caps the handoff at ten assets", () => {
    expect(
      normalizePreselectedSymbols(["A,B,C,D,E,F,G,H,I,J,K", "bad symbol", "<script>"]),
    ).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
  });

  it("opens the backtest builder when Mock Portfolio hands off symbols", () => {
    expect(initialQuantLabTab(["ETH"])).toBe("backtest");
    expect(initialQuantLabTab([])).toBe("optimizer");
  });

  it("accepts only executable catalog presets for the backtest handoff", () => {
    const preset = {
      strategyCode: "ma_crossover",
      strategyVersion: "1.0.0",
      strategyParameters: { slowPeriod: 20, fastPeriod: 5 },
    };

    expect(normalizeBacktestStrategyPreset(preset)).toEqual({
      strategyCode: "ma_crossover",
      strategyVersion: "1.0.0",
      strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
    });
    expect(
      normalizeBacktestStrategyPreset({ ...preset, strategyCode: "unknown_strategy" }),
    ).toBeNull();
  });

  it("accepts Strategy Lab as a first-class Quant Lab tab", () => {
    expect(normalizeQuantLabTab("strategies")).toBe("strategies");
    expect(normalizeQuantLabTab("unknown")).toBe("optimizer");
  });
});
