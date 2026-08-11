import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BacktestRun } from "@/lib/backtest/client";
import type { BacktestResultModel } from "@/lib/backtest/result-model";

type ActiveBacktestPortfolioProps = {
  run: BacktestRun;
  model: BacktestResultModel;
};

function money(value: number, currency: "USD" | "VND") {
  return new Intl.NumberFormat(currency === "VND" ? "vi-VN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(value);
}

function shortDate(value: string | undefined) {
  return value ? value.slice(0, 10) : "—";
}

export function ActiveBacktestPortfolio({ run, model }: ActiveBacktestPortfolioProps) {
  const firstPoint = model.aggregate.equity[0];
  const lastPoint = model.aggregate.equity.at(-1);
  const currency = model.aggregate.assumptions.baseCurrency;

  return (
    <Card className="min-w-0 max-w-full">
      <CardHeader>
        <CardTitle>Active Portfolio</CardTitle>
        <CardDescription>
          {shortDate(firstPoint?.timestamp)} – {shortDate(lastPoint?.timestamp)} · {run.timeframe} ·
          dataset versions {run.datasetVersionIds.length}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        {model.legs.map((leg) => {
          const submittedLeg = run.legs.find((item) => item.id === leg.id);
          return (
            <div key={leg.id} className="min-w-0 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{leg.symbol}</span>
                <Badge variant="secondary">
                  {submittedLeg?.strategyName ?? leg.strategyCode} v{leg.strategyVersion}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{(leg.allocationBps / 100).toFixed(2)}%</span>
                <span>{money(leg.initialNotional, currency)}</span>
                <span>{(submittedLeg?.leverage ?? 1).toFixed(1)}×</span>
                <span>dataset {leg.datasetVersionId.slice(0, 8)}</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
