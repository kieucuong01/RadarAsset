import { describe, expect, it } from "vitest";

import { parseBacktestRun, type BacktestRun } from "./client";
import { buildBacktestResultModel } from "./result-model";

const baseArtifact = {
  checksum: "a".repeat(64),
  rowCount: 1,
  schemaVersion: 1 as const,
};

function successfulRun(): BacktestRun {
  return parseBacktestRun({
    id: "run-1",
    strategyName: "Portfolio Backtest",
    strategyCode: null,
    strategyVersion: null,
    status: "succeeded",
    timeframe: "1d",
    progress: 100,
    strategyHash: "b".repeat(64),
    datasetVersionIds: ["dataset-btc"],
    engineVersion: "portfolio-v1",
    parameters: {},
    metrics: { initialEquity: 1000, finalEquity: 1100, totalReturnPct: 10 },
    errorMessage: null,
    startedAt: "2026-08-11T00:00:00.000Z",
    finishedAt: "2026-08-11T00:00:01.000Z",
    createdAt: "2026-08-11T00:00:00.000Z",
    cacheHit: false,
    sourceRunId: null,
    legs: [
      {
        id: "leg-btc",
        symbol: "BTC",
        market: "crypto_spot",
        currency: "USDT",
        allocationBps: 8000,
        initialNotional: 800,
        leverage: 1,
        strategyCode: "ma_crossover",
        strategyVersion: "1.0.0",
        strategyName: "MA Crossover",
        strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
        implementationHash: "c".repeat(64),
        datasetVersionId: "dataset-btc",
        status: "succeeded",
        progress: 100,
        metrics: { totalReturnPct: 12.5 },
        errorCode: null,
      },
    ],
    artifacts: [
      {
        id: "aggregate-equity",
        quantRunLegId: null,
        scopeKey: "aggregate",
        kind: "equity",
        payload: [
          {
            timestamp: "2024-01-01T00:00:00Z",
            cash: 200,
            marketValue: 800,
            grossExposure: 800,
            equity: 1000,
          },
        ],
        ...baseArtifact,
      },
      {
        id: "aggregate-drawdown",
        quantRunLegId: null,
        scopeKey: "aggregate",
        kind: "drawdown",
        payload: [{ timestamp: "2024-01-01T00:00:00Z", drawdownPct: 0 }],
        ...baseArtifact,
      },
      {
        id: "aggregate-contribution",
        quantRunLegId: null,
        scopeKey: "aggregate",
        kind: "contribution",
        payload: [
          { timestamp: "2024-01-01T00:00:00Z", equity: 1000, components: { BTC: 800, cash: 200 } },
        ],
        ...baseArtifact,
      },
      {
        id: "aggregate-cash-flow",
        quantRunLegId: null,
        scopeKey: "aggregate",
        kind: "cash_flow",
        payload: [
          { timestamp: "2024-02-01T00:00:00Z", type: "contribution", amount: 100, cashAmount: 20 },
        ],
        ...baseArtifact,
      },
      {
        id: "aggregate-rebalance",
        quantRunLegId: null,
        scopeKey: "aggregate",
        kind: "rebalance",
        payload: [
          {
            timestamp: "2024-02-01T00:00:00Z",
            frequency: "monthly",
            turnover: 40,
            cost: 0.04,
            transfers: { BTC: -20 },
          },
        ],
        ...baseArtifact,
      },
      {
        id: "aggregate-manifest",
        quantRunLegId: null,
        scopeKey: "aggregate",
        kind: "manifest",
        payload: {
          engineVersion: "portfolio-v1",
          assumptions: {
            cashAllocationBps: 2000,
            rebalanceFrequency: "monthly",
            monthlyContribution: 100,
            dividendMode: "exclude",
            fxPolicy: "normalized_returns",
            baseCurrency: "USD",
          },
        },
        ...baseArtifact,
      },
      {
        id: "leg-equity",
        quantRunLegId: "leg-btc",
        scopeKey: "leg:leg-btc",
        kind: "equity",
        payload: [
          {
            timestamp: "2024-01-01T00:00:00Z",
            cash: 0,
            marketValue: 800,
            grossExposure: 800,
            equity: 800,
          },
        ],
        ...baseArtifact,
      },
      {
        id: "leg-trades",
        quantRunLegId: "leg-btc",
        scopeKey: "leg:leg-btc",
        kind: "trades",
        payload: [],
        ...baseArtifact,
      },
      {
        id: "leg-manifest",
        quantRunLegId: "leg-btc",
        scopeKey: "leg:leg-btc",
        kind: "manifest",
        payload: { strategyCode: "ma_crossover", strategyVersion: "1.0.0" },
        ...baseArtifact,
      },
    ],
  });
}

describe("portfolio backtest result model", () => {
  it("builds aggregate cash contribution and per-leg views", () => {
    const model = buildBacktestResultModel(successfulRun());

    expect(model.aggregate.label).toBe("Normalized portfolio simulation");
    expect(model.aggregate.contribution[0]?.components).toEqual({ BTC: 800, cash: 200 });
    expect(model.aggregate.cashFlow[0]?.amount).toBe(100);
    expect(model.aggregate.robustness).toBeNull();
    expect(model.legs.map((leg) => leg.label)).toEqual(["BTC · MA Crossover"]);
  });

  it("parses immutable walk-forward selection and combined fragility", () => {
    const run = successfulRun();
    run.artifacts.push({
      id: "aggregate-robustness",
      quantRunLegId: null,
      scopeKey: "aggregate",
      kind: "robustness",
      payload: {
        method: "anchored_walk_forward_selection",
        candidateCount: 3,
        foldCount: 2,
        folds: [1, 2].map((fold) => ({
          fold,
          trainStart: "2024-01-01T00:00:00Z",
          trainEnd: "2024-02-01T00:00:00Z",
          testStart: "2024-02-02T00:00:00Z",
          testEnd: "2024-03-01T00:00:00Z",
          trainObservationCount: 31,
          testObservationCount: 28,
          referenceReturnPct: 5,
          outOfSampleReturnPct: 2,
          degradationPctPoints: -3,
          selectedCandidate: `candidate-${fold}`,
        })),
        outOfSampleMeanReturnPct: 2,
        outOfSampleReturnStdPct: 0,
        outOfSamplePositiveFoldPct: 100,
        sampleAdequacy: "adequate",
        warnings: [],
        disclaimer:
          "Anchored walk-forward selection.",
        overallStatus: "mixed",
        parameterStability: {
          status: "not_evaluated",
          score: null,
          warnings: ["NO_PARAMETER_NEIGHBORS"],
        },
      },
      ...baseArtifact,
    });

    expect(buildBacktestResultModel(run).aggregate.robustness).toMatchObject({
      foldCount: 2,
      candidateCount: 3,
      overallStatus: "mixed",
      parameterStability: { status: "not_evaluated" },
    });
  });

  it("rejects cross-leg scopes before unchecked JSON reaches React", () => {
    const run = successfulRun();
    run.artifacts[6] = { ...run.artifacts[6], scopeKey: "leg:another-leg" };

    expect(() => buildBacktestResultModel(run)).toThrow("artifact scope");
  });

  it("rejects malformed contribution and cash-flow payloads", () => {
    const contributionRun = successfulRun();
    contributionRun.artifacts[2] = {
      ...contributionRun.artifacts[2],
      payload: [{ timestamp: "2024-01-01T00:00:00Z", components: { cash: "200" } }],
    } as BacktestRun["artifacts"][number];
    expect(() => buildBacktestResultModel(contributionRun)).toThrow("contribution");

    const cashFlowRun = successfulRun();
    cashFlowRun.artifacts[3] = {
      ...cashFlowRun.artifacts[3],
      payload: [{ amount: -1 }],
    } as BacktestRun["artifacts"][number];
    expect(() => buildBacktestResultModel(cashFlowRun)).toThrow("cash-flow");
  });

  it("rejects a trade whose asset differs from its leg", () => {
    const run = successfulRun();
    run.artifacts[7] = {
      ...run.artifacts[7],
      payload: [
        {
          asset: "XAU",
          side: "long",
          entrySignalAt: "2024-01-01T00:00:00Z",
          entryAt: "2024-01-02T00:00:00Z",
          exitSignalAt: "2024-01-03T00:00:00Z",
          exitAt: "2024-01-04T00:00:00Z",
          entryPrice: 10,
          exitPrice: 11,
          quantity: 1,
          fees: 0,
          slippageCost: 0,
          realizedPnl: 1,
          returnPct: 10,
          barsHeld: 2,
          exitReason: "signal",
        },
      ],
    } as BacktestRun["artifacts"][number];

    expect(() => buildBacktestResultModel(run)).toThrow("trade asset");
  });
});
