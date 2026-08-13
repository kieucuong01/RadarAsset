import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BacktestRun } from "@/lib/backtest/client";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import { useI18n } from "@/lib/i18n/context";

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
  return value ? value.slice(0, 10) : "-";
}

export function ActiveBacktestPortfolio({ run, model }: ActiveBacktestPortfolioProps) {
  const { t } = useI18n();
  const firstPoint = model.aggregate.equity[0];
  const lastPoint = model.aggregate.equity.at(-1);
  const currency = model.aggregate.assumptions.baseCurrency;
  const adjustmentPolicy =
    model.aggregate.assumptions.dividendMode === "adjusted_prices" ? "total_return" : "raw";

  return (
    <Card className="min-w-0 max-w-full rounded-2xl shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{t("backtestResults.activePortfolio")}</CardTitle>
            <Badge variant={adjustmentPolicy === "total_return" ? "secondary" : "outline"}>
              {adjustmentPolicy === "total_return"
                ? t("backtestResults.adjustedData")
                : t("backtestResults.rawData")}
            </Badge>
          </div>
          <CardDescription className="font-mono text-xs uppercase tracking-wider">
            {model.legs.length} {t("backtestResults.legs")} · {shortDate(firstPoint?.timestamp)} -{" "}
            {shortDate(lastPoint?.timestamp)} · {run.timeframe}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        {model.legs.map((leg, index) => {
          const submittedLeg = run.legs.find((item) => item.id === leg.id);
          const leverage = submittedLeg?.leverage ?? 1;

          return (
            <div key={leg.id} className="min-w-0 rounded-xl border bg-muted/50 px-4 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="font-semibold text-primary">#{index + 1}</span>
                <span className="font-semibold text-foreground">{leg.symbol}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  {submittedLeg?.strategyName ?? leg.strategyCode}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-primary">{(leg.allocationBps / 100).toFixed(2)}%</span>
                {leverage > 1 ? (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <Badge variant="outline">{leverage.toFixed(1)}x</Badge>
                  </>
                ) : null}
              </div>
              <span className="sr-only">{money(leg.initialNotional, currency)}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
