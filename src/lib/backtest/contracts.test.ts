import { describe, expect, it } from "vitest";

import {
  backtestSubmissionSchema,
  createRollingBacktestRange,
  normalizeBacktestSubmission,
} from "./contracts";
import { hashBacktestSubmission } from "./hash";

const validPortfolioSubmission = {
  timeframe: "1d" as const,
  from: "2025-01-01",
  to: "2026-01-01",
  totalCapital: 100_000,
  allocationMode: "custom" as const,
  feeBps: 10,
  slippageBps: 5,
  legs: [
    {
      symbol: "vnm",
      allocationBps: 3000,
      leverage: 2,
      strategyCode: "ma_crossover",
      strategyVersion: "1.0.0",
      strategyParameters: { slowPeriod: 20, fastPeriod: 5 },
    },
    {
      symbol: "btc",
      allocationBps: 7000,
      leverage: 1,
      strategyCode: "turtle_breakout",
      strategyVersion: "1.0.0",
      strategyParameters: { exitPeriod: 10, entryPeriod: 20 },
    },
  ],
};

describe("portfolio backtest submission contract", () => {
  it("normalizes every leg independently and sorts the canonical portfolio", () => {
    expect(normalizeBacktestSubmission(validPortfolioSubmission)).toEqual({
      timeframe: "1d",
      from: "2025-01-01",
      to: "2026-01-01",
      totalCapital: 100_000,
      allocationMode: "custom",
      feeBps: 10,
      slippageBps: 5,
      legs: [
        {
          symbol: "BTC",
          allocationBps: 7000,
          leverage: 1,
          strategyCode: "turtle_breakout",
          strategyVersion: "1.0.0",
          strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
        },
        {
          symbol: "VNM",
          allocationBps: 3000,
          leverage: 2,
          strategyCode: "ma_crossover",
          strategyVersion: "1.0.0",
          strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
        },
      ],
    });
  });

  it("keeps the portfolio hash stable across leg and parameter-key ordering", () => {
    const first = hashBacktestSubmission(validPortfolioSubmission);
    const second = hashBacktestSubmission({
      ...validPortfolioSubmission,
      legs: [...validPortfolioSubmission.legs].reverse().map((leg) => ({
        ...leg,
        strategyParameters: Object.fromEntries(
          Object.entries(leg.strategyParameters).reverse(),
        ),
      })),
    });

    expect(second).toBe(first);
    expect(hashBacktestSubmission({ ...validPortfolioSubmission, feeBps: 11 })).not.toBe(first);
  });

  it("maps the legacy shared-strategy payload to equal independent legs", () => {
    expect(
      normalizeBacktestSubmission({
        strategyCode: "ma_crossover",
        strategyVersion: "1.0.0",
        strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
        timeframe: "1d",
        initialCapital: 10_000,
        feeBps: 10,
        slippageBps: 5,
        from: "2024-01-01",
        to: "2024-02-01",
        legs: [
          { symbol: "VNM", leverage: 2 },
          { symbol: "BTC", leverage: 1 },
        ],
      }),
    ).toMatchObject({
      totalCapital: 10_000,
      allocationMode: "equal",
      legs: [
        {
          symbol: "BTC",
          allocationBps: 5000,
          strategyCode: "ma_crossover",
          strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
        },
        {
          symbol: "VNM",
          allocationBps: 5000,
          strategyCode: "ma_crossover",
          strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
        },
      ],
    });
  });

  it.each([
    ["duplicate symbols", { ...validPortfolioSubmission, legs: [validPortfolioSubmission.legs[0], validPortfolioSubmission.legs[0]] }],
    ["allocation below 10,000 bps", { ...validPortfolioSubmission, legs: validPortfolioSubmission.legs.map((leg, index) => ({ ...leg, allocationBps: index === 0 ? 2999 : leg.allocationBps })) }],
    ["more than ten legs", { ...validPortfolioSubmission, legs: Array.from({ length: 11 }, (_, index) => ({ ...validPortfolioSubmission.legs[0], symbol: `VN${index}`, allocationBps: index === 0 ? 10000 : 0 })) }],
    ["a nonexistent calendar date", { ...validPortfolioSubmission, from: "2025-02-30" }],
    ["a reversed date range", { ...validPortfolioSubmission, from: "2027-01-01" }],
    ["one leg with invalid parameters", { ...validPortfolioSubmission, legs: [validPortfolioSubmission.legs[0], { ...validPortfolioSubmission.legs[1], strategyParameters: { entryPeriod: 20, exitPeriod: 10, execute: "shell" } }] }],
  ])("rejects %s", (_name, payload) => {
    expect(backtestSubmissionSchema.safeParse(payload).success).toBe(false);
  });

  it("defaults new runs to a recent UTC window instead of an obsolete fixed year", () => {
    expect(createRollingBacktestRange(new Date("2026-08-11T02:00:00Z"))).toEqual({
      from: "2026-04-13",
      to: "2026-08-11",
    });
  });
});
