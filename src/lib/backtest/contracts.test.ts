import { describe, expect, it } from "vitest";

import {
  backtestSubmissionSchema,
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

describe("real backtest submission contract", () => {
  it("normalizes leg ordering and produces a stable pinned strategy hash", () => {
    const normalized = normalizeBacktestSubmission(validSubmission);

    expect(normalized.legs).toEqual([
      { symbol: "BTC", leverage: 1 },
      { symbol: "FPT", leverage: 2 },
      { symbol: "XAU", leverage: 1 },
    ]);
    expect(hashBacktestSubmission(normalized)).toBe(
      "d5a7e8a029b1e3002798d23a39711eb240178b2e7f0b48624a2ce6fcf3e76350",
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
      "d5a7e8a029b1e3002798d23a39711eb240178b2e7f0b48624a2ce6fcf3e76350",
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
