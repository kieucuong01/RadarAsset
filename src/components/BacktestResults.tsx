"use client";

import { useMemo } from "react";

import { ActiveBacktestPortfolio } from "@/components/backtest-results/ActiveBacktestPortfolio";
import { BacktestAdvancedAnalysis } from "@/components/backtest-results/BacktestAdvancedAnalysis";
import { BacktestKpiGrid } from "@/components/backtest-results/BacktestKpiGrid";
import { BacktestTradeList } from "@/components/backtest-results/BacktestTradeList";
import { EquityDrawdownChart } from "@/components/backtest-results/EquityDrawdownChart";
import type { BacktestRun } from "@/lib/backtest/client";
import { buildBacktestResultModel } from "@/lib/backtest/result-model";
import { useI18n } from "@/lib/i18n/context";

export function BacktestResults({ run }: { run: BacktestRun }) {
  const { t } = useI18n();
  const model = useMemo(() => buildBacktestResultModel(run), [run]);
  const currency = model.aggregate.assumptions.baseCurrency;

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-label={t("backtestResults.aria")}>
      <ActiveBacktestPortfolio run={run} model={model} />
      <EquityDrawdownChart model={model} currency={currency} />
      <BacktestKpiGrid model={model} />
      <BacktestTradeList model={model} currency={currency} />
      <BacktestAdvancedAnalysis run={run} model={model} currency={currency} />
    </section>
  );
}
