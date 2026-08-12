import { ArrowDownRight, ArrowUpRight, Gauge, Target, TrendingUp } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import { buildBacktestKpis } from "@/lib/backtest/result-presentation";
import { cn } from "@/lib/utils";

function formatMetric(value: number | null, suffix = "", digits = 2) {
  return value === null ? "-" : `${value.toFixed(digits)}${suffix}`;
}

export function BacktestKpiGrid({ model }: { model: BacktestResultModel }) {
  const kpis = buildBacktestKpis(model);
  const items = [
    {
      label: "Max Drawdown",
      value: formatMetric(kpis.maxDrawdownPct, "%"),
      hint: "Peak-to-trough loss",
      tone: "text-rose-600",
      icon: ArrowDownRight,
    },
    {
      label: "Profit Factor",
      value: formatMetric(kpis.profitFactor),
      hint: "Gross W / Gross L",
      tone: "text-emerald-600",
      icon: Target,
    },
    {
      label: "Sharpe Ratio",
      value: formatMetric(kpis.sharpe),
      hint: "Risk-adjusted return",
      tone: "text-foreground",
      icon: Gauge,
    },
    {
      label: "Win Rate",
      value: formatMetric(kpis.winRatePct, "%", 1),
      hint: "Winning trades",
      tone: "text-emerald-600",
      icon: ArrowUpRight,
    },
    {
      label: "Total Return",
      value: formatMetric(kpis.totalReturnPct, "%", 1),
      hint: "Portfolio return",
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
      aria-label="Backtest KPIs"
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
