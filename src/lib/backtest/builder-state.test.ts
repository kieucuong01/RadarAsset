import { describe, expect, it } from "vitest";

import type { QuantAssetCatalogItem } from "./asset-client";
import {
  applyOptimizerProposal,
  builderValidationReasons,
  createInitialBuilderState,
  createInitialBuilderStateForLocale,
  strategyInputWithPreset,
  reduceBuilder,
  toPortfolioBacktestSubmission,
} from "./builder-state";
import { OPTIMIZER_SOURCES } from "./optimizer-methods";
import { listStrategyCatalog } from "./strategy-catalog";

const strategyCatalog = listStrategyCatalog();
const ma = strategyCatalog.find((strategy) => strategy.code === "ma_crossover")!;
const turtle = strategyCatalog.find((strategy) => strategy.code === "turtle_breakout")!;

function asset(
  symbol: string,
  market: QuantAssetCatalogItem["market"],
  datasetVersionId: string,
  maxLeverage = 1,
): QuantAssetCatalogItem {
  return {
    symbol,
    name: `${symbol} asset`,
    market,
    venue: null,
    currency: market === "vn_equity" ? "VND" : "USD",
    maxLeverage,
    timeframe: "1d",
    datasetVersionId,
    coverageStart: "2024-01-01T00:00:00.000Z",
    coverageEnd: "2026-12-31T00:00:00.000Z",
    rowCount: 500,
    freshness: "fresh",
    backtestable: true,
    reasonCode: null,
    listingStatus: "active",
    availableAdjustments: ["raw"],
    calendarVersion:
      market === "vn_equity" ? "hose-official-closures-2024-2026-v1" : "crypto-24x7-v1",
    qualityIssueCount: 0,
    blockingQualityIssueCount: 0,
    catalogCoverage: {
      firstObservedAt: "2024-01-01T00:00:00.000Z",
      completeForRequestedRange: true,
      warningCode: null,
    },
  };
}

const btc = asset("BTC", "crypto_spot", "11111111-1111-4111-8111-111111111111");
const vnm = asset("VNM", "vn_equity", "22222222-2222-4222-8222-222222222222", 2);

function addTwoAssets() {
  let state = createInitialBuilderState(new Date("2026-08-11T00:00:00.000Z"));
  state = reduceBuilder(state, { type: "cashAllocationEdited", cashAllocationBps: 2_000 });
  state = reduceBuilder(state, { type: "assetAdded", asset: vnm, strategy: ma });
  return reduceBuilder(state, { type: "assetAdded", asset: btc, strategy: turtle });
}

function optimizerProposal(
  weightsBps: Record<string, number>,
  datasetVersionIds = {
    BTC: btc.datasetVersionId!,
    VNM: vnm.datasetVersionId!,
  },
) {
  return {
    method: "risk_parity" as const,
    source: OPTIMIZER_SOURCES.skfolio,
    weightsBps,
    totalWeightBps: 8_000,
    expectedReturnPct: 12,
    volatilityPct: 18,
    sharpe: 0.67,
    observationCount: 252,
    assetMetrics: [
      { symbol: "BTC", expectedReturnPct: 14, volatilityPct: 22 },
      { symbol: "VNM", expectedReturnPct: 10, volatilityPct: 15 },
    ],
    correlationMatrix: [
      { symbol: "BTC", correlations: { BTC: 1, VNM: 0.25 } },
      { symbol: "VNM", correlations: { BTC: 0.25, VNM: 1 } },
    ],
    validation: {
      split: "chronological_70_30" as const,
      trainObservationCount: 176,
      testObservationCount: 76,
      inSample: {
        expectedReturnPct: 12,
        volatilityPct: 18,
        sharpe: 0.67,
        maxDrawdownPct: -10,
      },
      outOfSample: {
        expectedReturnPct: 8,
        volatilityPct: 20,
        sharpe: 0.4,
        maxDrawdownPct: -14,
      },
    },
    datasetVersionIds,
    warnings: [],
  };
}

describe("portfolio backtest builder state", () => {
  it("uses the UI locale only when initializing a new builder currency", () => {
    const now = new Date("2026-08-11T00:00:00.000Z");
    const vietnamese = createInitialBuilderStateForLocale("vi", now);
    const english = createInitialBuilderStateForLocale("en", now);

    expect(vietnamese.assumptions.baseCurrency).toBe("VND");
    expect(english.assumptions.baseCurrency).toBe("USD");

    const editedVietnamese = reduceBuilder(vietnamese, {
      type: "assumptionEdited",
      key: "baseCurrency",
      value: "VND",
    });
    createInitialBuilderStateForLocale("en", now);
    expect(editedVietnamese.assumptions.baseCurrency).toBe("VND");
  });

  it("starts empty without injecting fixed assets", () => {
    const state = createInitialBuilderState(new Date("2026-08-11T00:00:00.000Z"));

    expect(state.legs).toEqual([]);
    expect(builderValidationReasons(state)).toContain("Add at least one backtestable asset.");
  });

  it("localizes validation reasons for the active UI locale", () => {
    const state = createInitialBuilderState(new Date("2026-08-11T00:00:00.000Z"));

    expect(builderValidationReasons(state, "vi")).toContain(
      "Thêm ít nhất một tài sản có thể backtest.",
    );
    expect(builderValidationReasons(state, "en")).toContain("Add at least one backtestable asset.");
  });

  it("blocks total-return mode when any leg only has raw data", () => {
    const state = addTwoAssets();
    const adjusted = reduceBuilder(state, {
      type: "assumptionEdited",
      key: "dividendMode",
      value: "adjusted_prices",
    });

    expect(builderValidationReasons(adjusted)).toContain(
      "BTC does not have a total_return dataset for this range.",
    );
  });

  it("distributes equal weights over the investable allocation after add and remove", () => {
    const withTwo = addTwoAssets();
    expect(withTwo.legs.map((leg) => [leg.symbol, leg.allocationBps])).toEqual([
      ["BTC", 4_000],
      ["VNM", 4_000],
    ]);
    expect(withTwo.assumptions.cashAllocationBps).toBe(2_000);

    const withOne = reduceBuilder(withTwo, { type: "assetRemoved", symbol: "BTC" });
    expect(withOne.legs.map((leg) => [leg.symbol, leg.allocationBps])).toEqual([["VNM", 8_000]]);
  });

  it("switches to custom mode on manual edit and exposes an invalid total", () => {
    const edited = reduceBuilder(addTwoAssets(), {
      type: "allocationEdited",
      symbol: "BTC",
      allocationBps: 3_500,
    });

    expect(edited.allocationMode).toBe("custom");
    expect(builderValidationReasons(edited)).toContain(
      "Asset and cash weights must total exactly 100%.",
    );
  });

  it("applies an immutable optimizer proposal while preserving cash", () => {
    const optimized = applyOptimizerProposal(
      addTwoAssets(),
      optimizerProposal({ BTC: 5_000, VNM: 3_000 }),
    );

    expect(optimized.allocationMode).toBe("optimized");
    expect(optimized.assumptions.cashAllocationBps).toBe(2_000);
    expect(optimized.legs.map((leg) => [leg.symbol, leg.allocationBps])).toEqual([
      ["BTC", 5_000],
      ["VNM", 3_000],
    ]);
  });

  it("rejects a stale optimizer proposal whose dataset no longer matches", () => {
    expect(() =>
      applyOptimizerProposal(
        addTwoAssets(),
        optimizerProposal({ BTC: 4_000, VNM: 4_000 }, { BTC: "stale", VNM: vnm.datasetVersionId! }),
      ),
    ).toThrow("datasets no longer match");
  });

  it("refreshes selected asset eligibility and invalidates an old optimizer proposal", () => {
    const optimized = applyOptimizerProposal(
      addTwoAssets(),
      optimizerProposal({ BTC: 4_000, VNM: 4_000 }),
    );
    const refreshed = reduceBuilder(optimized, {
      type: "assetRefreshed",
      asset: { ...btc, datasetVersionId: "33333333-3333-4333-8333-333333333333" },
    });

    expect(refreshed.legs.find((leg) => leg.symbol === "BTC")?.datasetVersionId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(refreshed.optimizerProposal).toBeNull();
  });

  it("updates strategies and parameters independently per asset", () => {
    const changed = reduceBuilder(addTwoAssets(), {
      type: "strategyChanged",
      symbol: "VNM",
      strategy: turtle,
    });
    const parameterEdited = reduceBuilder(changed, {
      type: "strategyParameterEdited",
      symbol: "VNM",
      parameter: "entryPeriod",
      value: 55,
    });

    expect(parameterEdited.legs.find((leg) => leg.symbol === "VNM")).toMatchObject({
      strategyCode: "turtle_breakout",
      strategyParameters: { entryPeriod: 55, exitPeriod: 10 },
    });
    expect(parameterEdited.legs.find((leg) => leg.symbol === "BTC")).toMatchObject({
      strategyCode: "turtle_breakout",
      strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
    });
  });

  it("applies a normalized Strategy Lab preset when adding a compatible asset", () => {
    const strategy = strategyInputWithPreset(ma, {
      strategyCode: "ma_crossover",
      strategyVersion: "1.0.0",
      strategyParameters: { fastPeriod: 8, slowPeriod: 34 },
    });
    const state = reduceBuilder(createInitialBuilderState(), {
      type: "assetAdded",
      asset: vnm,
      strategy,
    });

    expect(state.legs[0]).toMatchObject({
      strategyCode: "ma_crossover",
      strategyVersion: "1.0.0",
      strategyName: "MA Crossover",
      strategyParameters: { fastPeriod: 8, slowPeriod: 34 },
    });
  });

  it("builds a canonical cash-aware submission only when the draft is valid", () => {
    const state = addTwoAssets();
    const submission = toPortfolioBacktestSubmission(state);

    expect(submission.assumptions.cashAllocationBps).toBe(2_000);
    expect(submission.legs).toEqual([
      expect.objectContaining({ symbol: "BTC", allocationBps: 4_000 }),
      expect.objectContaining({ symbol: "VNM", allocationBps: 4_000 }),
    ]);
  });
});
