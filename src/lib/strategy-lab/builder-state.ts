import type { ExecutableRule } from "@/lib/custom-strategies/contracts";
import { defaultCurrency } from "@/lib/financial-format";
import type { Locale } from "@/lib/i18n/dictionary";

import { STRATEGY_CATALOG } from "../backtest/strategy-catalog";

export type StrategyBuilderKind =
  | "catalog_preset"
  | "scheduled_dca"
  | "price_threshold"
  | "fundamental_threshold";

export type StrategyBuilderState = {
  name: string;
  symbol: string;
  kind: StrategyBuilderKind;
  strategyCode: string;
  strategyParameters: Record<string, number>;
  amount: number;
  currency: "USD" | "VND";
  dayOfMonth: number;
  priceOperator: "crosses_above" | "crosses_below";
  priceValue: number;
  action: "buy" | "sell";
  sizePct: number;
  metric: "pb" | "pe" | "roe";
  fundamentalOperator: "lt" | "lte" | "gt" | "gte";
  fundamentalValue: number;
};

export function createInitialStrategyBuilderState(
  name: string,
  locale: Locale,
): StrategyBuilderState {
  const strategy = STRATEGY_CATALOG[0];
  return {
    name,
    symbol: "BTC",
    kind: "catalog_preset",
    strategyCode: strategy.code,
    strategyParameters: { ...strategy.defaultParameters },
    amount: 400,
    currency: defaultCurrency(locale),
    dayOfMonth: 1,
    priceOperator: "crosses_below",
    priceValue: 50_000,
    action: "sell",
    sizePct: 100,
    metric: "pb",
    fundamentalOperator: "lt",
    fundamentalValue: 4,
  };
}

export function applySavedRuleToStrategyBuilder(
  current: StrategyBuilderState,
  saved: { name: string; symbol: string | null; rule: ExecutableRule },
): StrategyBuilderState {
  if (saved.rule.kind === "scheduled_dca") {
    return {
      ...current,
      name: saved.name,
      symbol: saved.symbol ?? current.symbol,
      kind: "scheduled_dca",
      amount: saved.rule.contributionAmount,
      currency: saved.rule.currency,
      dayOfMonth: saved.rule.dayOfMonth,
    };
  }
  return {
    ...current,
    name: saved.name,
    symbol: saved.symbol ?? current.symbol,
    kind: "price_threshold",
    priceOperator: saved.rule.operator,
    priceValue: saved.rule.threshold,
    currency: saved.rule.currency,
    action: saved.rule.action,
    sizePct: saved.rule.sizePct,
  };
}
