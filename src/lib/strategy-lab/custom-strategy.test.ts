import { describe, expect, it } from "vitest";

import {
  customStrategyReadiness,
  describeCustomStrategy,
  normalizeCustomStrategy,
  parseStoredCustomStrategies,
  serializeCustomStrategies,
} from "./custom-strategy";

const catalogPreset = {
  schemaVersion: 1,
  id: "preset-ma",
  name: "MA cho FPT",
  symbol: "fpt",
  kind: "catalog_preset",
  strategyCode: "ma_crossover",
  strategyVersion: "1.0.0",
  strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
} as const;

const dcaRule = {
  schemaVersion: 1,
  id: "dca-btc",
  name: "DCA BTC",
  symbol: "btc",
  kind: "scheduled_dca",
  amount: 400,
  currency: "USD",
  frequency: "monthly",
  dayOfMonth: 1,
} as const;

const vndDcaRule = {
  ...dcaRule,
  amount: 1_000_000,
  currency: "VND",
} as const;

const priceRule = {
  schemaVersion: 1,
  id: "price-btc",
  name: "Mua BTC",
  symbol: "btc",
  kind: "price_threshold",
  operator: "crosses_below",
  value: 56_200.25,
  currency: "USD",
  action: "buy",
  sizePct: 12.35,
} as const;

describe("custom strategy rules", () => {
  it("normalizes executable catalog presets through the canonical validator", () => {
    expect(normalizeCustomStrategy(catalogPreset)).toMatchObject({
      symbol: "FPT",
      readiness: "executable",
      strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
    });
  });

  it("distinguishes missing engine support from missing point-in-time data", () => {
    expect(customStrategyReadiness(dcaRule)).toMatchObject({ status: "executable" });
    expect(
      customStrategyReadiness({
        schemaVersion: 1,
        id: "pb-fpt",
        name: "FPT định giá thấp",
        symbol: "FPT",
        kind: "fundamental_threshold",
        metric: "pb",
        operator: "lt",
        value: 4,
        action: "buy",
      }),
    ).toMatchObject({ status: "data_required" });
  });

  it("rejects unsafe amounts and produces a readable summary", () => {
    expect(() => normalizeCustomStrategy({ ...dcaRule, amount: 0 })).toThrow();
    expect(describeCustomStrategy(dcaRule)).toContain("400 USD");
    expect(describeCustomStrategy(dcaRule)).toContain("BTC");
  });

  it("formats strategy money, prices, percentages, and ratios with explicit units", () => {
    expect(describeCustomStrategy(vndDcaRule)).toContain("1,000,000 VND");
    expect(describeCustomStrategy(priceRule, "vi")).toBe(
      "Mua 12.35% BTC khi giá cắt xuống 56,200.25 USD.",
    );
    expect(describeCustomStrategy(priceRule, "en")).toBe(
      "Buy 12.35% BTC when price crosses below 56,200.25 USD.",
    );
    expect(
      describeCustomStrategy(
        {
          schemaVersion: 1,
          id: "pb-fpt",
          name: "FPT valuation",
          symbol: "FPT",
          kind: "fundamental_threshold",
          metric: "pb",
          operator: "lt",
          value: 4.123456,
          action: "buy",
        },
        "en",
      ),
    ).toBe("Buy FPT when PB is less than 4.1235.");
  });

  it("round-trips valid local drafts and ignores malformed storage", () => {
    const stored = serializeCustomStrategies([catalogPreset, dcaRule]);

    expect(parseStoredCustomStrategies(stored)).toHaveLength(2);
    expect(parseStoredCustomStrategies("not-json")).toEqual([]);
    expect(parseStoredCustomStrategies(JSON.stringify({ version: 99, strategies: [] }))).toEqual(
      [],
    );
  });
});
