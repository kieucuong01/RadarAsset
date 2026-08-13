import { backtestSymbolSchema } from "./contracts";
import { normalizeStrategyParameters, strategyDefinition } from "./strategy-catalog";

export type BacktestStrategyPreset = {
  strategyCode: string;
  strategyVersion: string;
  strategyParameters: Record<string, unknown>;
};

export type QuantLabTab = "optimizer" | "strategies" | "backtest" | "factors" | "predict";

const QUANT_LAB_TABS = new Set<QuantLabTab>([
  "optimizer",
  "strategies",
  "backtest",
  "factors",
  "predict",
]);

export function normalizeQuantLabTab(input: unknown): QuantLabTab {
  return typeof input === "string" && QUANT_LAB_TABS.has(input as QuantLabTab)
    ? (input as QuantLabTab)
    : "optimizer";
}

export function normalizeBacktestStrategyPreset(input: unknown): BacktestStrategyPreset | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Partial<BacktestStrategyPreset>;
  if (
    typeof candidate.strategyCode !== "string" ||
    typeof candidate.strategyVersion !== "string" ||
    !candidate.strategyParameters ||
    typeof candidate.strategyParameters !== "object"
  ) {
    return null;
  }
  try {
    if (candidate.strategyCode.startsWith("custom:")) {
      return {
        strategyCode: candidate.strategyCode,
        strategyVersion: candidate.strategyVersion,
        strategyParameters: {},
      };
    }
    strategyDefinition(candidate.strategyCode, candidate.strategyVersion);
    return {
      strategyCode: candidate.strategyCode,
      strategyVersion: candidate.strategyVersion,
      strategyParameters: normalizeStrategyParameters(
        candidate.strategyCode,
        candidate.strategyParameters,
      ),
    };
  } catch {
    return null;
  }
}

export function normalizePreselectedSymbols(input: string | string[] | undefined) {
  const values = input === undefined ? [] : Array.isArray(input) ? input : [input];
  const symbols: string[] = [];
  for (const value of values.flatMap((item) => item.split(","))) {
    const parsed = backtestSymbolSchema.safeParse(value);
    if (!parsed.success || symbols.includes(parsed.data)) continue;
    symbols.push(parsed.data);
    if (symbols.length === 10) break;
  }
  return symbols;
}

export function initialQuantLabTab(symbols: string[]): "optimizer" | "backtest" {
  return symbols.length > 0 ? "backtest" : "optimizer";
}
