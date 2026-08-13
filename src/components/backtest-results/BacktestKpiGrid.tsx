import { ArrowDownRight, ArrowUpRight, Gauge, Target, TrendingUp } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import { buildBacktestKpis } from "@/lib/backtest/result-presentation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

function formatMetric(value: number | null, suffix = "", digits = 2) {
  return value === null ? "-" : `${value.toFixed(digits)}${suffix}`;
}

export function BacktestKpiGrid({ model }: { model: BacktestResultModel }) {
  const { t } = useI18n();
  const kpis = buildBacktestKpis(model);
  const items = [
    {
      label: t("backtestResults.maxDrawdown"),
      value: formatMetric(kpis.maxDrawdownPct, "%"),
      hint: t("backtestResults.peakLoss"),
      tone: "text-rose-600",
      icon: ArrowDownRight,
    },
    {
      label: t("backtestResults.profitFactor"),
      value: formatMetric(kpis.profitFactor),
      hint: t("backtestResults.grossWL"),
      tone: "text-emerald-600",
      icon: Target,
    },
    {
      label: t("backtestResults.sharpeRatio"),
      value: formatMetric(kpis.sharpe),
      hint: t("backtestResults.riskAdjusted"),
      tone: "text-foreground",
      icon: Gauge,
    },
    {
      label: t("backtestResults.winRate"),
      value: formatMetric(kpis.winRatePct, "%", 1),
      hint: t("backtestResults.winningTrades"),
      tone: "text-emerald-600",
      icon: ArrowUpRight,
    },
    {
      label: t("backtestResults.totalReturn"),
      value: formatMetric(kpis.totalReturnPct, "%", 1),
      hint: t("backtestResults.portfolioReturn"),
      tone:
        kpis.totalReturnPct !== null && kpis.totalReturnPct < 0
          ? "text-rose-600"
          : "text-emerald-600",
      icon: TrendingUp,
    },
  ];

  return (
    <section
      className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-5"
      aria-label={t("backtestResults.kpisAria")}
    >
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <Card key={item.label} className="min-w-0 rounded-2xl shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <CardDescription className="font-mono text-xs uppercase tracking-wider">
                  {item.label}
                </CardDescription>
                <Icon className={cn("size-4", item.tone)} />
              </div>
              <CardTitle className={cn("text-3xl tabular-nums", item.tone)}>{item.value}</CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-xs text-muted-foreground">
              {item.hint}
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
