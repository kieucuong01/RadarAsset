import { describe, expect, it } from "vitest";

import { STRATEGY_CATALOG } from "@/lib/backtest/strategy-catalog";

import { listStrategyLibrary } from "./library";

describe("strategy education library", () => {
  it("documents every executable catalog strategy as technical", () => {
    const library = listStrategyLibrary();

    expect(library).toHaveLength(STRATEGY_CATALOG.length);
    expect(library.every((entry) => entry.family === "technical")).toBe(true);
    expect(library.map((entry) => entry.code).sort()).toEqual(
      STRATEGY_CATALOG.map((entry) => entry.code).sort(),
    );
  });

  it("provides decision-useful guidance instead of only a strategy name", () => {
    expect(listStrategyLibrary().find((entry) => entry.code === "ma_crossover")).toMatchObject({
      thesis: expect.stringContaining("xu hướng"),
      entryRule: expect.any(String),
      exitRule: expect.any(String),
      idealConditions: expect.arrayContaining([expect.any(String)]),
      risks: expect.arrayContaining([expect.any(String)]),
      dataRequirements: expect.arrayContaining(["OHLCV"]),
    });
  });
});
