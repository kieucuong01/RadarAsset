import { describe, expect, it } from "vitest";

import { normalizeStrategyAssignment } from "./assignment-contracts";

describe("portfolio strategy assignment contract", () => {
  it("normalizes strategy parameters and optional source run", () => {
    expect(
      normalizeStrategyAssignment({
        symbol: "btc",
        strategyCode: "turtle_breakout",
        strategyVersion: "1.0.0",
        strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
        backtestRunId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toEqual({
      symbol: "BTC",
      strategyCode: "turtle_breakout",
      strategyVersion: "1.0.0",
      strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
      backtestRunId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("rejects unknown parameters and unsafe symbols", () => {
    expect(() =>
      normalizeStrategyAssignment({
        symbol: "ETH",
        strategyCode: "ma_crossover",
        strategyVersion: "1.0.0",
        strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
      }),
    ).toThrow();
    expect(() =>
      normalizeStrategyAssignment({
        symbol: "FPT",
        strategyCode: "ma_crossover",
        strategyVersion: "1.0.0",
        strategyParameters: { fastPeriod: 20, slowPeriod: 5, sql: "drop" },
      }),
    ).toThrow();
  });
});
