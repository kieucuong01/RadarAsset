import { describe, expect, it } from "vitest";

import { buildOptimizerDashboardModel } from "./optimizer-dashboard";
import { OPTIMIZER_SOURCES } from "./optimizer-methods";
import type { OptimizerProposal } from "./optimizer-client";

const proposal: OptimizerProposal = {
  method: "risk_parity",
  source: OPTIMIZER_SOURCES.skfolio,
  weightsBps: { BTC: 5_000, VNM: 3_000, XAU: 2_000 },
  totalWeightBps: 10_000,
  expectedReturnPct: 12,
  volatilityPct: 18,
  sharpe: 0.67,
  observationCount: 252,
  assetMetrics: [
    { symbol: "BTC", expectedReturnPct: 16, volatilityPct: 28 },
    { symbol: "VNM", expectedReturnPct: 10, volatilityPct: 14 },
    { symbol: "XAU", expectedReturnPct: 6, volatilityPct: 9 },
  ],
  correlationMatrix: [
    { symbol: "BTC", correlations: { BTC: 1, VNM: 0.42, XAU: -0.12 } },
    { symbol: "VNM", correlations: { BTC: 0.42, VNM: 1, XAU: 0.08 } },
    { symbol: "XAU", correlations: { BTC: -0.12, VNM: 0.08, XAU: 1 } },
  ],
  validation: {
    split: "chronological_70_30",
    trainObservationCount: 176,
    testObservationCount: 76,
    inSample: { expectedReturnPct: 13, volatilityPct: 17, sharpe: 0.76, maxDrawdownPct: -8 },
    outOfSample: { expectedReturnPct: 8, volatilityPct: 20, sharpe: 0.4, maxDrawdownPct: -12 },
  },
  datasetVersionIds: {
    BTC: "dataset-btc",
    VNM: "dataset-vnm",
    XAU: "dataset-xau",
  },
  warnings: [],
};

describe("optimizer dashboard model", () => {
  it("builds sorted allocation slices, risk-return points and correlation rows", () => {
    const model = buildOptimizerDashboardModel(proposal);

    expect(model.symbols).toEqual(["BTC", "VNM", "XAU"]);
    expect(model.allocationSlices.map((slice) => [slice.symbol, slice.weightPct])).toEqual([
      ["BTC", 50],
      ["VNM", 30],
      ["XAU", 20],
    ]);
    expect(model.riskReturnPoints).toEqual([
      {
        symbol: "BTC",
        expectedReturnPct: 16,
        volatilityPct: 28,
        weightPct: 50,
        datasetVersionId: "dataset-btc",
      },
      {
        symbol: "VNM",
        expectedReturnPct: 10,
        volatilityPct: 14,
        weightPct: 30,
        datasetVersionId: "dataset-vnm",
      },
      {
        symbol: "XAU",
        expectedReturnPct: 6,
        volatilityPct: 9,
        weightPct: 20,
        datasetVersionId: "dataset-xau",
      },
    ]);
    expect(model.correlationRows[0]).toEqual({
      symbol: "BTC",
      values: [
        { symbol: "BTC", value: 1 },
        { symbol: "VNM", value: 0.42 },
        { symbol: "XAU", value: -0.12 },
      ],
    });
  });
});
