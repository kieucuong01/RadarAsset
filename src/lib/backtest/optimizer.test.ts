import { describe, expect, it } from "vitest";

import { optimizePortfolioAllocation, OPTIMIZER_SOURCES } from "./optimizer";

function alternating(length: number, high: number, low: number) {
  return Array.from({ length }, (_, index) => (index % 2 === 0 ? high : low));
}

function patterned(length: number, average: number, scale: number, modulo: number) {
  return Array.from(
    { length },
    (_, index) => average + ((index % modulo) - (modulo - 1) / 2) * scale,
  );
}

describe("awesome-quant sourced portfolio optimizer", () => {
  it("uses PortfolioAllocation equal weights as the baseline method", () => {
    const result = optimizePortfolioAllocation({
      method: "equal_weight",
      returnsBySymbol: {
        FPT: alternating(40, 0.012, 0.008),
        BTC: alternating(40, 0.002, -0.002),
        XAU: alternating(40, 0.004, 0.001),
      },
      maxWeightBps: 7_000,
    });

    expect(result.method).toBe("equal_weight");
    expect(result.source).toEqual(OPTIMIZER_SOURCES.portfolioAllocation);
    expect(result.weightsBps).toEqual({ BTC: 3_334, FPT: 3_333, XAU: 3_333 });
    expect(Object.values(result.weightsBps).reduce((sum, value) => sum + value, 0)).toBe(10_000);
    expect(result.observationCount).toBe(40);
    expect(result.assetMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol: "BTC", expectedReturnPct: 0, volatilityPct: 3.22 }),
        expect.objectContaining({ symbol: "FPT", expectedReturnPct: 252, volatilityPct: 3.22 }),
        expect.objectContaining({ symbol: "XAU", expectedReturnPct: 63, volatilityPct: 2.41 }),
      ]),
    );
    expect(result.correlationMatrix).toEqual([
      {
        symbol: "BTC",
        correlations: expect.objectContaining({ BTC: 1, FPT: 1, XAU: 1 }),
      },
      {
        symbol: "FPT",
        correlations: expect.objectContaining({ BTC: 1, FPT: 1, XAU: 1 }),
      },
      {
        symbol: "XAU",
        correlations: expect.objectContaining({ BTC: 1, FPT: 1, XAU: 1 }),
      },
    ]);
  });

  it("uses PortfolioAllocation inverse volatility instead of return chasing", () => {
    const result = optimizePortfolioAllocation({
      method: "inverse_volatility",
      returnsBySymbol: {
        CALM: alternating(40, 0.003, 0.002),
        WILD: alternating(40, 0.04, -0.04),
      },
      maxWeightBps: 10_000,
    });

    expect(result.weightsBps.CALM).toBeGreaterThan(result.weightsBps.WILD);
    expect(Object.values(result.weightsBps).reduce((sum, value) => sum + value, 0)).toBe(10_000);
  });

  it("uses PortfolioAllocation constrained minimum variance when risk is prioritized", () => {
    const result = optimizePortfolioAllocation({
      method: "minimum_variance",
      returnsBySymbol: {
        BTC: alternating(40, 0.02, -0.02),
        XAU: alternating(40, 0.004, -0.001),
      },
      maxWeightBps: 7_000,
    });

    expect(result.weightsBps.XAU).toBeGreaterThan(result.weightsBps.BTC);
    expect(Math.max(...Object.values(result.weightsBps))).toBeLessThanOrEqual(7_000);
  });

  it("uses PortfolioAllocation equal risk contribution for risk parity", () => {
    const result = optimizePortfolioAllocation({
      method: "risk_parity",
      returnsBySymbol: {
        BTC: alternating(40, 0.02, -0.02),
        FPT: alternating(40, 0.006, -0.002),
        XAU: alternating(40, 0.004, -0.001),
      },
      maxWeightBps: 6_000,
    });

    expect(result.weightsBps.BTC).toBeLessThan(result.weightsBps.XAU);
    expect(Math.max(...Object.values(result.weightsBps))).toBeLessThanOrEqual(6_000);
  });

  it("is invariant to input key order", () => {
    const btc = alternating(40, 0.01, -0.006);
    const vnm = alternating(40, 0.006, -0.001);
    const first = optimizePortfolioAllocation({
      method: "maximum_sharpe",
      returnsBySymbol: { BTC: btc, VNM: vnm },
      maxWeightBps: 8_000,
    });
    const second = optimizePortfolioAllocation({
      method: "maximum_sharpe",
      returnsBySymbol: { VNM: vnm, BTC: btc },
      maxWeightBps: 8_000,
    });

    expect(second).toEqual(first);
  });

  it("keeps maximum Sharpe usable when the positive excess-return frontier is unavailable", () => {
    const result = optimizePortfolioAllocation({
      method: "maximum_sharpe",
      returnsBySymbol: {
        BTC: alternating(40, -0.018, -0.012),
        VNM: alternating(40, -0.006, -0.003),
      },
      maxWeightBps: 7_000,
    });

    expect(Object.values(result.weightsBps).reduce((sum, value) => sum + value, 0)).toBe(10_000);
    expect(Math.max(...Object.values(result.weightsBps))).toBeLessThanOrEqual(7_000);
    expect(result.warnings).toContain("MAX_SHARPE_FALLBACK_MIN_VARIANCE");
  });

  it("computes a constrained Markowitz target-return allocation", () => {
    const result = optimizePortfolioAllocation({
      method: "target_return",
      returnsBySymbol: {
        BTC: alternating(40, 0.012, 0.008),
        VNM: alternating(40, 0.005, 0.003),
      },
      maxWeightBps: 7_000,
      targetReturnPct: 0.8,
      periodsPerYear: 1,
    });

    expect(result.weightsBps.BTC).toBeGreaterThan(result.weightsBps.VNM);
    expect(Object.values(result.weightsBps).reduce((sum, value) => sum + value, 0)).toBe(10_000);
  });

  it("computes a constrained Markowitz target-volatility allocation", () => {
    const result = optimizePortfolioAllocation({
      method: "target_volatility",
      returnsBySymbol: {
        BTC: patterned(40, 0.006, 0.006, 5),
        XAU: patterned(40, 0.002, 0.002, 7),
      },
      maxWeightBps: 8_000,
      targetVolatilityPct: 0.5,
      periodsPerYear: 1,
    });

    expect(result.method).toBe("target_volatility");
    expect(Object.values(result.weightsBps).reduce((sum, value) => sum + value, 0)).toBe(10_000);
    expect(Math.max(...Object.values(result.weightsBps))).toBeLessThanOrEqual(8_000);
  });

  it("computes a constrained Markowitz risk-tolerance allocation", () => {
    const result = optimizePortfolioAllocation({
      method: "risk_tolerance",
      returnsBySymbol: {
        BTC: alternating(40, 0.012, 0.008),
        XAU: alternating(40, 0.004, -0.001),
      },
      maxWeightBps: 7_000,
      riskTolerance: 1,
      periodsPerYear: 1,
    });

    expect(result.method).toBe("risk_tolerance");
    expect(Object.values(result.weightsBps).reduce((sum, value) => sum + value, 0)).toBe(10_000);
    expect(Math.max(...Object.values(result.weightsBps))).toBeLessThanOrEqual(7_000);
  });

  it("allocates one eligible asset and preserves a reserved cash target", () => {
    const result = optimizePortfolioAllocation({
      method: "most_diversified",
      returnsBySymbol: { XAU: alternating(40, 0.004, -0.001) },
      maxWeightBps: 10_000,
      totalWeightBps: 8_000,
    });

    expect(result.weightsBps).toEqual({ XAU: 8_000 });
  });

  it("rejects fewer than thirty aligned observations", () => {
    expect(() =>
      optimizePortfolioAllocation({
        method: "risk_parity",
        returnsBySymbol: { BTC: Array(29).fill(0.01), VNM: Array(29).fill(0.005) },
        maxWeightBps: 7_000,
      }),
    ).toThrow("at least 30");
  });

  it("rejects unconstrained source methods when their natural weight breaches the cap", () => {
    expect(() =>
      optimizePortfolioAllocation({
        method: "minimum_correlation",
        returnsBySymbol: {
          CALM: alternating(40, 0.003, 0.002),
          WILD: alternating(40, 0.04, -0.04),
        },
        maxWeightBps: 5_500,
      }),
    ).toThrow("does not support max-weight repair");
  });

  it("handles singular covariance without non-finite metrics", () => {
    const result = optimizePortfolioAllocation({
      method: "equal_weight",
      returnsBySymbol: { BTC: Array(40).fill(0.01), VNM: Array(40).fill(0.01) },
      maxWeightBps: 7_000,
    });

    expect(result.weightsBps).toEqual({ BTC: 5_000, VNM: 5_000 });
    expect(result.volatilityPct).toBe(0);
    expect(result.sharpe).toBeNull();
    expect(result.warnings).toContain("SINGULAR_COVARIANCE");
  });
});
