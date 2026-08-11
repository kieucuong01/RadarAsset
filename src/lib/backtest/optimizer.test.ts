import { describe, expect, it } from "vitest";

import { optimizeMeanVariance } from "./optimizer";

function alternating(length: number, high: number, low: number) {
  return Array.from({ length }, (_, index) => (index % 2 === 0 ? high : low));
}

describe("deterministic mean-variance optimizer", () => {
  it("returns long-only capped basis points in stable symbol order", () => {
    const result = optimizeMeanVariance({
      returnsBySymbol: {
        FPT: alternating(40, 0.012, 0.008),
        BTC: alternating(40, 0.002, -0.002),
      },
      riskAversion: 4,
      maxWeightBps: 7_000,
    });

    expect(result.weightsBps).toEqual({ BTC: 3_000, FPT: 7_000 });
    expect(Object.values(result.weightsBps).reduce((sum, value) => sum + value, 0)).toBe(10_000);
    expect(Object.values(result.weightsBps).every((value) => value >= 0 && value <= 7_000)).toBe(
      true,
    );
    expect(result.observationCount).toBe(40);
  });

  it("is invariant to input key order", () => {
    const btc = alternating(40, 0.01, -0.006);
    const vnm = alternating(40, 0.006, -0.001);
    const first = optimizeMeanVariance({
      returnsBySymbol: { BTC: btc, VNM: vnm },
      riskAversion: 6,
      maxWeightBps: 8_000,
    });
    const second = optimizeMeanVariance({
      returnsBySymbol: { VNM: vnm, BTC: btc },
      riskAversion: 6,
      maxWeightBps: 8_000,
    });

    expect(second).toEqual(first);
  });

  it("allocates one eligible asset and preserves a reserved cash target", () => {
    const result = optimizeMeanVariance({
      returnsBySymbol: { XAU: alternating(40, 0.004, -0.001) },
      riskAversion: 3,
      maxWeightBps: 10_000,
      totalWeightBps: 8_000,
    });

    expect(result.weightsBps).toEqual({ XAU: 8_000 });
  });

  it("rejects fewer than thirty aligned observations", () => {
    expect(() =>
      optimizeMeanVariance({
        returnsBySymbol: { BTC: Array(29).fill(0.01), VNM: Array(29).fill(0.005) },
        riskAversion: 4,
        maxWeightBps: 7_000,
      }),
    ).toThrow("at least 30");
  });

  it("handles singular covariance without non-finite metrics", () => {
    const result = optimizeMeanVariance({
      returnsBySymbol: { BTC: Array(40).fill(0.01), VNM: Array(40).fill(0.01) },
      riskAversion: 5,
      maxWeightBps: 7_000,
    });

    expect(result.weightsBps).toEqual({ BTC: 5_000, VNM: 5_000 });
    expect(result.volatilityPct).toBe(0);
    expect(result.sharpe).toBeNull();
    expect(result.warnings).toContain("SINGULAR_COVARIANCE");
  });
});
