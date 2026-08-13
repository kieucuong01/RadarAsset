"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import { alignEquityAndDrawdown, buildBacktestKpis } from "@/lib/backtest/result-presentation";
import { useI18n } from "@/lib/i18n/context";

type EquityDrawdownChartProps = {
  model: BacktestResultModel;
  currency: "USD" | "VND";
};

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

function metricValue(value: number | null, digits = 2) {
  return value === null ? "-" : value.toFixed(digits);
}

export function EquityDrawdownChart({ model, currency }: EquityDrawdownChartProps) {
  const { t } = useI18n();
  const gradientId = useId().replaceAll(":", "");
  const kpis = buildBacktestKpis(model);
  const rows = alignEquityAndDrawdown(model.aggregate.equity, model.aggregate.drawdown).map(
    (point, index) => ({ ...point, date: `D${index}` }),
  );
  const money = new Intl.NumberFormat(currency === "VND" ? "vi-VN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });

  return (
    <Card className="min-w-0 max-w-full overflow-hidden rounded-2xl shadow-sm">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Activity className="text-primary" />
            {t("backtestResults.equityTitle")}
            <span className="font-mono text-xs font-normal uppercase tracking-wider text-muted-foreground">
              {t("common.portfolio")} · {model.legs.length} {t("backtestResults.legs")}
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-0.5 w-4 bg-primary" />
              {t("backtestResults.strategy")}{" "}
              <span
                className={
                  kpis.totalReturnPct !== null && kpis.totalReturnPct >= 0
                    ? "text-emerald-600"
                    : "text-rose-600"
                }
              >
                {metricValue(kpis.totalReturnPct, 1)}%
              </span>
            </span>
            <span className="text-muted-foreground">{t("backtestResults.benchmarkPending")}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-0 p-0 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="h-96 min-w-0 p-6" aria-label={t("backtestResults.portfolioCurveAria")}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                fontSize={11}
              />
              <YAxis tickLine={false} axisLine={false} width={68} fontSize={11} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => money.format(Number(value))}
              />
              <Area
                type="monotone"
                dataKey="equity"
                name={t("backtestResults.equityTitle")}
                stroke="var(--primary)"
                strokeWidth={3}
                fill={`url(#${gradientId})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <aside className="border-t p-5 lg:border-l lg:border-t-0">
          <p className="mb-4 font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Drawdown
          </p>
          <div className="h-48 min-w-0" aria-label={t("backtestResults.drawdownAria")}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis hide dataKey="date" />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  fontSize={11}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value) => [
                    `${Number(value).toFixed(2)}%`,
                    t("backtestResults.drawdown"),
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="drawdownPct"
                  name={t("backtestResults.drawdown")}
                  stroke="var(--destructive)"
                  fill="var(--destructive)"
                  fillOpacity={0.12}
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border p-3">
              <p className="font-mono text-[10px] uppercase text-muted-foreground">Max DD</p>
              <p className="mt-1 font-semibold text-rose-600">
                {metricValue(kpis.maxDrawdownPct, 2)}%
              </p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="font-mono text-[10px] uppercase text-muted-foreground">Sharpe</p>
              <p className="mt-1 font-semibold">{metricValue(kpis.sharpe, 2)}</p>
            </div>
          </div>
        </aside>
      </CardContent>
    </Card>
  );
}
