import { describe, expect, it } from "vitest";

import {
  backtestSubmissionSchema,
  createRollingBacktestRange,
  hashBacktestSubmission,
  maximumLeverageForAsset,
  normalizeBacktestSubmission,
} from "./contracts";

const validSubmission = {
  strategy: "ma_cross",
  timeframe: "1d",
  fastPeriod: 2,
  slowPeriod: 3,
  initialCapital: 10_000,
  feeBps: 10,
  slippageBps: 5,
  from: "2024-01-01",
  to: "2024-02-01",
  legs: [
    { symbol: "XAU", leverage: 1 },
    { symbol: "FPT", leverage: 2 },
    { symbol: "BTC", leverage: 1 },
  ],
} as const;

const genericSubmission = {
  strategyCode: "turtle_breakout" as const,
  strategyVersion: "1.0.0" as const,
  strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
  timeframe: "1d" as const,
  initialCapital: 10_000,
  feeBps: 10,
  slippageBps: 5,
  from: "2024-01-01",
  to: "2024-02-01",
  legs: [{ symbol: "BTC" as const, leverage: 1 }],
};

describe("real backtest submission contract", () => {
  it("normalizes a catalog strategy and validates its strategy-specific parameters", () => {
    expect(normalizeBacktestSubmission(genericSubmission)).toEqual({
      ...genericSubmission,
      legs: [{ symbol: "BTC", leverage: 1 }],
    });
    expect(backtestSubmissionSchema.safeParse(genericSubmission).success).toBe(true);
    expect(
      backtestSubmissionSchema.safeParse({
        ...genericSubmission,
        strategyParameters: { entryPeriod: 20, exitPeriod: 25, unsafe: true },
      }).success,
    ).toBe(false);
    expect(
      backtestSubmissionSchema.safeParse({ ...genericSubmission, strategyVersion: "9.9.9" })
        .success,
    ).toBe(false);

    expect(() =>
      normalizeBacktestSubmission({
        ...genericSubmission,
        strategyCode: "ma_crossover",
        strategyParameters: { fastPeriod: 20, slowPeriod: 5 },
      }),
    ).toThrowError();
  });

  it("maps the legacy MA payload to the versioned catalog contract", () => {
    expect(normalizeBacktestSubmission(validSubmission)).toMatchObject({
      strategyCode: "ma_crossover",
      strategyVersion: "1.0.0",
      strategyParameters: { fastPeriod: 2, slowPeriod: 3 },
    });
  });

  it("defaults new runs to a recent UTC window instead of an obsolete fixed year", () => {
    expect(createRollingBacktestRange(new Date("2026-08-11T02:00:00Z"))).toEqual({
      from: "2026-04-13",
      to: "2026-08-11",
    });
  });

  it("normalizes leg ordering and produces a stable pinned strategy hash", () => {
    const normalized = normalizeBacktestSubmission(validSubmission);

    expect(normalized.legs).toEqual([
      { symbol: "BTC", leverage: 1 },
      { symbol: "FPT", leverage: 2 },
      { symbol: "XAU", leverage: 1 },
    ]);
    expect(hashBacktestSubmission(normalized)).toBe(
      "9000e840f0cd09fdd39e17335d953d0365bd1ba81a10f84e6db4beedd999be97",
    );

    const reorderedKeys = {
      legs: [...validSubmission.legs].reverse(),
      to: validSubmission.to,
      from: validSubmission.from,
      slippageBps: validSubmission.slippageBps,
      feeBps: validSubmission.feeBps,
      initialCapital: validSubmission.initialCapital,
      slowPeriod: validSubmission.slowPeriod,
      fastPeriod: validSubmission.fastPeriod,
      timeframe: validSubmission.timeframe,
      strategy: validSubmission.strategy,
    };
    expect(hashBacktestSubmission(normalizeBacktestSubmission(reorderedKeys))).toBe(
      "9000e840f0cd09fdd39e17335d953d0365bd1ba81a10f84e6db4beedd999be97",
    );
  });

  it.each([
    ["unknown strategy", { ...validSubmission, strategy: "user_python" }],
    ["unknown timeframe", { ...validSubmission, timeframe: "5m" }],
    ["fast period not below slow period", { ...validSubmission, fastPeriod: 3 }],
    ["period above complexity limit", { ...validSubmission, slowPeriod: 401 }],
    ["non-positive capital", { ...validSubmission, initialCapital: 0 }],
    ["excessive fee", { ...validSubmission, feeBps: 101 }],
    ["excessive slippage", { ...validSubmission, slippageBps: 201 }],
    ["reversed date range", { ...validSubmission, from: "2024-03-01" }],
    ["unknown asset", { ...validSubmission, legs: [{ symbol: "ETH", leverage: 1 }] }],
    [
      "duplicate asset",
      {
        ...validSubmission,
        legs: [
          { symbol: "BTC", leverage: 1 },
          { symbol: "BTC", leverage: 1 },
        ],
      },
    ],
    ["crypto leverage", { ...validSubmission, legs: [{ symbol: "BTC", leverage: 1.01 }] }],
    ["gold leverage", { ...validSubmission, legs: [{ symbol: "XAU", leverage: 1.1 }] }],
    ["Vietnam leverage", { ...validSubmission, legs: [{ symbol: "FPT", leverage: 2.01 }] }],
  ])("rejects %s", (_name, payload) => {
    expect(backtestSubmissionSchema.safeParse(payload).success).toBe(false);
  });

  it("exposes explicit leverage caps without silently clamping input", () => {
    expect(maximumLeverageForAsset("FPT")).toBe(2);
    expect(maximumLeverageForAsset("BTC")).toBe(1);
    expect(maximumLeverageForAsset("XAU")).toBe(1);
  });
});
