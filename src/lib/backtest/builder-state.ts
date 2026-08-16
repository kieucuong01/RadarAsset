import type { QuantAssetCatalogItem } from "./asset-client";
import type { StrategyCatalogItem } from "./client";
import {
  canonicalBacktestSubmissionSchema,
  createDefaultPortfolioAssumptions,
  createRollingBacktestRange,
  type PortfolioAssumptions,
  type PortfolioBacktestSubmission,
} from "./contracts";
import type { OptimizerProposal } from "./optimizer-client";
import type { BacktestStrategyPreset } from "./preselection";
import { normalizeStrategyParameters } from "./strategy-catalog";
import { defaultCurrency } from "../financial-format";
import { translate, type Locale } from "../i18n/dictionary";

export type AllocationMode = "equal" | "custom" | "optimized";

export type BuilderStrategyInput = Pick<
  StrategyCatalogItem,
  "code" | "version" | "name" | "defaultParameters"
> & {
  parameterSchema: readonly StrategyCatalogItem["parameterSchema"][number][];
  supportedMarkets: readonly string[];
  supportedTimeframes: readonly ("1d" | "1h")[];
};

export type DraftBacktestLeg = QuantAssetCatalogItem & {
  allocationBps: number;
  leverage: number;
  strategyCode: string;
  strategyVersion: string;
  strategyName: string;
  strategyParameters: Record<string, unknown>;
  strategyParameterSchema: StrategyCatalogItem["parameterSchema"];
  supportedMarkets: string[];
  supportedTimeframes: Array<"1d" | "1h">;
};

export type BuilderState = {
  totalCapital: number;
  allocationMode: AllocationMode;
  timeframe: "1d" | "1h";
  from: string;
  to: string;
  feeBps: number;
  slippageBps: number;
  assumptions: PortfolioAssumptions;
  legs: DraftBacktestLeg[];
  optimizerProposal: OptimizerProposal | null;
};

export type BuilderAction =
  | { type: "assetAdded"; asset: QuantAssetCatalogItem; strategy: BuilderStrategyInput }
  | { type: "assetRefreshed"; asset: QuantAssetCatalogItem }
  | { type: "assetRemoved"; symbol: string }
  | { type: "allocationEdited"; symbol: string; allocationBps: number }
  | { type: "allocationModeChanged"; allocationMode: Exclude<AllocationMode, "optimized"> }
  | { type: "cashAllocationEdited"; cashAllocationBps: number }
  | { type: "strategyChanged"; symbol: string; strategy: BuilderStrategyInput }
  | { type: "strategyParameterEdited"; symbol: string; parameter: string; value: number }
  | { type: "leverageEdited"; symbol: string; leverage: number }
  | { type: "totalCapitalEdited"; totalCapital: number }
  | { type: "timeframeChanged"; timeframe: "1d" | "1h" }
  | { type: "rangeChanged"; from: string; to: string }
  | {
      type: "assumptionEdited";
      key: "rebalanceFrequency" | "monthlyContribution" | "dividendMode" | "baseCurrency";
      value:
        | PortfolioAssumptions["rebalanceFrequency"]
        | PortfolioAssumptions["dividendMode"]
        | PortfolioAssumptions["baseCurrency"]
        | number;
    }
  | {
      type: "marketCostEdited";
      market: keyof PortfolioAssumptions["marketCosts"];
      key: keyof PortfolioAssumptions["marketCosts"]["vn_equity"];
      value: number;
    }
  | { type: "optimizerApplied"; proposal: OptimizerProposal };

function clampInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function equalAllocationForTotal(symbols: string[], totalBps: number) {
  const ordered = [...new Set(symbols)].sort();
  if (ordered.length === 0) return {};
  const base = Math.floor(totalBps / ordered.length);
  let remainder = totalBps - base * ordered.length;
  return Object.fromEntries(ordered.map((symbol) => [symbol, base + (remainder-- > 0 ? 1 : 0)]));
}

function rebalanceEqual(state: BuilderState, legs = state.legs) {
  const weights = equalAllocationForTotal(
    legs.map((leg) => leg.symbol),
    10_000 - state.assumptions.cashAllocationBps,
  );
  return legs.map((leg) => ({ ...leg, allocationBps: weights[leg.symbol] ?? 0 }));
}

function strategyFields(strategy: BuilderStrategyInput) {
  return {
    strategyCode: strategy.code,
    strategyVersion: strategy.version,
    strategyName: strategy.name,
    strategyParameters: strategy.code.startsWith("custom:")
      ? {}
      : { ...strategy.defaultParameters },
    strategyParameterSchema: [...strategy.parameterSchema],
    supportedMarkets: [...strategy.supportedMarkets],
    supportedTimeframes: [...strategy.supportedTimeframes],
  };
}

export function strategyInputWithPreset(
  strategy: BuilderStrategyInput,
  preset: BacktestStrategyPreset,
): BuilderStrategyInput {
  if (strategy.code !== preset.strategyCode || strategy.version !== preset.strategyVersion) {
    return strategy;
  }
  return {
    ...strategy,
    defaultParameters: preset.strategyCode.startsWith("custom:")
      ? {}
      : (normalizeStrategyParameters(preset.strategyCode, preset.strategyParameters) as Record<
          string,
          number
        >),
  };
}

export function createInitialBuilderState(now = new Date()): BuilderState {
  const range = createRollingBacktestRange(now);
  return {
    totalCapital: 100_000,
    allocationMode: "equal",
    timeframe: "1d",
    from: range.from,
    to: range.to,
    feeBps: 10,
    slippageBps: 5,
    assumptions: createDefaultPortfolioAssumptions(10, 5),
    legs: [],
    optimizerProposal: null,
  };
}

export function createInitialBuilderStateForLocale(locale: Locale, now = new Date()): BuilderState {
  const state = createInitialBuilderState(now);
  return {
    ...state,
    assumptions: {
      ...state.assumptions,
      baseCurrency: defaultCurrency(locale),
    },
  };
}

export function applyOptimizerProposal(
  state: BuilderState,
  proposal: OptimizerProposal,
): BuilderState {
  const currentSymbols = state.legs.map((leg) => leg.symbol).sort();
  const proposalSymbols = Object.keys(proposal.weightsBps).sort();
  if (currentSymbols.join("|") !== proposalSymbols.join("|")) {
    throw new Error("Optimizer symbols no longer match the builder.");
  }
  const investableBps = 10_000 - state.assumptions.cashAllocationBps;
  if (proposal.totalWeightBps !== investableBps) {
    throw new Error("Optimizer target no longer matches the cash allocation.");
  }
  for (const leg of state.legs) {
    if (proposal.datasetVersionIds[leg.symbol] !== leg.datasetVersionId) {
      throw new Error("Optimizer datasets no longer match the selected assets.");
    }
  }
  return {
    ...state,
    allocationMode: "optimized",
    optimizerProposal: proposal,
    legs: state.legs.map((leg) => ({
      ...leg,
      allocationBps: proposal.weightsBps[leg.symbol],
    })),
  };
}

export function reduceBuilder(state: BuilderState, action: BuilderAction): BuilderState {
  if (action.type === "assetAdded") {
    if (state.legs.some((leg) => leg.symbol === action.asset.symbol)) return state;
    if (state.legs.length >= 10)
      throw new Error("A portfolio backtest supports at most 10 assets.");
    if (!action.asset.backtestable || !action.asset.datasetVersionId) {
      throw new Error(`${action.asset.symbol} is not backtestable for the selected range.`);
    }
    const added: DraftBacktestLeg = {
      ...action.asset,
      allocationBps: 0,
      leverage: 1,
      ...strategyFields(action.strategy),
    };
    const legs = [...state.legs, added].sort((left, right) =>
      left.symbol.localeCompare(right.symbol),
    );
    return {
      ...state,
      optimizerProposal: null,
      legs: state.allocationMode === "equal" ? rebalanceEqual(state, legs) : legs,
    };
  }
  if (action.type === "assetRemoved") {
    const legs = state.legs.filter((leg) => leg.symbol !== action.symbol);
    return {
      ...state,
      optimizerProposal: null,
      legs: state.allocationMode === "equal" ? rebalanceEqual(state, legs) : legs,
    };
  }
  if (action.type === "assetRefreshed") {
    return {
      ...state,
      optimizerProposal: null,
      allocationMode: state.allocationMode === "optimized" ? "custom" : state.allocationMode,
      legs: state.legs.map((leg) =>
        leg.symbol === action.asset.symbol ? { ...leg, ...action.asset } : leg,
      ),
    };
  }
  if (action.type === "allocationEdited") {
    return {
      ...state,
      allocationMode: "custom",
      optimizerProposal: null,
      legs: state.legs.map((leg) =>
        leg.symbol === action.symbol
          ? { ...leg, allocationBps: clampInteger(action.allocationBps, 0, 10_000) }
          : leg,
      ),
    };
  }
  if (action.type === "allocationModeChanged") {
    return {
      ...state,
      allocationMode: action.allocationMode,
      optimizerProposal: null,
      legs: action.allocationMode === "equal" ? rebalanceEqual(state) : state.legs,
    };
  }
  if (action.type === "cashAllocationEdited") {
    const assumptions = {
      ...state.assumptions,
      cashAllocationBps: clampInteger(action.cashAllocationBps, 0, 10_000),
    };
    const next = { ...state, assumptions, optimizerProposal: null };
    return {
      ...next,
      allocationMode: state.allocationMode === "optimized" ? "custom" : state.allocationMode,
      legs: state.allocationMode === "equal" ? rebalanceEqual(next) : state.legs,
    };
  }
  if (action.type === "strategyChanged") {
    return {
      ...state,
      legs: state.legs.map((leg) =>
        leg.symbol === action.symbol ? { ...leg, ...strategyFields(action.strategy) } : leg,
      ),
    };
  }
  if (action.type === "strategyParameterEdited") {
    return {
      ...state,
      legs: state.legs.map((leg) =>
        leg.symbol === action.symbol
          ? {
              ...leg,
              strategyParameters: {
                ...leg.strategyParameters,
                [action.parameter]: action.value,
              },
            }
          : leg,
      ),
    };
  }
  if (action.type === "leverageEdited") {
    return {
      ...state,
      legs: state.legs.map((leg) =>
        leg.symbol === action.symbol ? { ...leg, leverage: action.leverage } : leg,
      ),
    };
  }
  if (action.type === "totalCapitalEdited") return { ...state, totalCapital: action.totalCapital };
  if (action.type === "timeframeChanged") {
    return { ...state, timeframe: action.timeframe, optimizerProposal: null };
  }
  if (action.type === "rangeChanged") {
    return { ...state, from: action.from, to: action.to, optimizerProposal: null };
  }
  if (action.type === "assumptionEdited") {
    return {
      ...state,
      assumptions: { ...state.assumptions, [action.key]: action.value },
      optimizerProposal: null,
    } as BuilderState;
  }
  if (action.type === "marketCostEdited") {
    return {
      ...state,
      assumptions: {
        ...state.assumptions,
        marketCosts: {
          ...state.assumptions.marketCosts,
          [action.market]: {
            ...state.assumptions.marketCosts[action.market],
            [action.key]: action.value,
          },
        },
      },
      optimizerProposal: null,
    };
  }
  return applyOptimizerProposal(state, action.proposal);
}

export function builderValidationReasons(state: BuilderState, locale: Locale = "en") {
  const reasons: string[] = [];
  if (state.legs.length === 0) reasons.push(translate(locale, "backtest.builder.validation.asset"));
  const allocationTotal =
    state.assumptions.cashAllocationBps +
    state.legs.reduce((total, leg) => total + leg.allocationBps, 0);
  if (allocationTotal !== 10_000) {
    reasons.push(translate(locale, "backtest.builder.validation.allocation"));
  }
  if (!Number.isFinite(state.totalCapital) || state.totalCapital <= 0) {
    reasons.push(translate(locale, "backtest.builder.validation.capital"));
  }
  if (state.from > state.to) reasons.push(translate(locale, "backtest.builder.validation.dates"));
  const adjustmentPolicy =
    state.assumptions.dividendMode === "adjusted_prices" ? "total_return" : "raw";
  for (const leg of state.legs) {
    if (!leg.backtestable || !leg.datasetVersionId || leg.timeframe !== state.timeframe) {
      reasons.push(
        translate(locale, "backtest.builder.validation.dataset", {
          symbol: leg.symbol,
          timeframe: state.timeframe,
        }),
      );
    }
    if (!leg.availableAdjustments.includes(adjustmentPolicy)) {
      reasons.push(
        translate(locale, "backtest.builder.validation.adjustment", {
          symbol: leg.symbol,
          policy: adjustmentPolicy,
        }),
      );
    }
    if (leg.leverage < 1 || leg.leverage > leg.maxLeverage) {
      reasons.push(
        translate(locale, "backtest.builder.validation.leverage", {
          symbol: leg.symbol,
          max: leg.maxLeverage,
        }),
      );
    }
    if (
      !leg.supportedMarkets.includes(leg.market) ||
      !leg.supportedTimeframes.includes(state.timeframe)
    ) {
      reasons.push(
        translate(locale, "backtest.builder.validation.strategy", {
          strategy: leg.strategyName,
          symbol: leg.symbol,
          timeframe: state.timeframe,
        }),
      );
    }
    try {
      if (!leg.strategyCode.startsWith("custom:")) {
        normalizeStrategyParameters(leg.strategyCode, leg.strategyParameters);
      }
    } catch {
      reasons.push(
        translate(locale, "backtest.builder.validation.parameters", { symbol: leg.symbol }),
      );
    }
  }
  if (!canonicalBacktestSubmissionSchema.safeParse(toUncheckedSubmission(state)).success) {
    if (reasons.length === 0) {
      reasons.push(translate(locale, "backtest.builder.validation.assumptions"));
    }
  }
  return [...new Set(reasons)];
}

function toUncheckedSubmission(state: BuilderState): PortfolioBacktestSubmission {
  return {
    timeframe: state.timeframe,
    from: state.from,
    to: state.to,
    totalCapital: state.totalCapital,
    allocationMode: state.allocationMode,
    feeBps: state.feeBps,
    slippageBps: state.slippageBps,
    assumptions: state.assumptions,
    legs: state.legs.map((leg) => ({
      symbol: leg.symbol,
      allocationBps: leg.allocationBps,
      leverage: leg.leverage,
      strategyCode: leg.strategyCode,
      strategyVersion: leg.strategyVersion,
      strategyParameters: leg.strategyParameters,
    })),
  };
}

export function toPortfolioBacktestSubmission(
  state: BuilderState,
  locale: Locale = "en",
): PortfolioBacktestSubmission {
  const reasons = builderValidationReasons(state, locale);
  if (reasons.length > 0) throw new Error(reasons.join(" "));
  return canonicalBacktestSubmissionSchema.parse(
    toUncheckedSubmission(state),
  ) as PortfolioBacktestSubmission;
}
