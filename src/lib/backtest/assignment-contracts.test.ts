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
        backtestRunLegId: "00000000-0000-4000-8000-000000000002",
      }),
    ).toEqual({
      symbol: "BTC",
      strategyCode: "turtle_breakout",
      strategyVersion: "1.0.0",
      strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
      backtestRunId: "00000000-0000-4000-8000-000000000001",
      backtestRunLegId: "00000000-0000-4000-8000-000000000002",
    });
  });

  it("accepts any safe system symbol and rejects unsafe symbols or parameters", () => {
    expect(
      normalizeStrategyAssignment({
        symbol: "eth/usdt",
        strategyCode: "ma_crossover",
        strategyVersion: "1.0.0",
        strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
      }).symbol,
    ).toBe("ETH/USDT");
    expect(() =>
      normalizeStrategyAssignment({
        symbol: "../ETH<script>",
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

  it("requires the run and leg IDs together", () => {
    expect(() =>
      normalizeStrategyAssignment({
        symbol: "BTC",
        strategyCode: "ma_crossover",
        strategyVersion: "1.0.0",
        strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
        backtestRunId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toThrow();
  });
});
