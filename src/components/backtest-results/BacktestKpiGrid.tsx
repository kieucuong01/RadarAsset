import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import { buildBacktestKpis } from "@/lib/backtest/result-presentation";

export function BacktestKpiGrid({ model }: { model: BacktestResultModel }) {
  const kpis = buildBacktestKpis(model);
  const items = [
    { label: "Total Return", value: kpis.totalReturnPct, suffix: "%" },
    { label: "Max Drawdown", value: kpis.maxDrawdownPct, suffix: "%" },
    { label: "Sharpe", value: kpis.sharpe, suffix: "" },
    { label: "Win Rate", value: kpis.winRatePct, suffix: "%" },
    { label: "Profit Factor", value: kpis.profitFactor, suffix: "" },
  ];

  return (
    <section
      className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5"
      aria-label="Backtest KPIs"
    >
      {items.map((item) => (
        <Card key={item.label} className="min-w-0">
          <CardHeader className="pb-2">
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {item.value === null ? "—" : `${item.value.toFixed(2)}${item.suffix}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="sr-only">Artifact-backed metric</CardContent>
        </Card>
      ))}
    </section>
  );
}
