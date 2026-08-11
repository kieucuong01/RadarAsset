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

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import { alignEquityAndDrawdown } from "@/lib/backtest/result-presentation";

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

export function EquityDrawdownChart({ model, currency }: EquityDrawdownChartProps) {
  const gradientId = useId().replaceAll(":", "");
  const rows = alignEquityAndDrawdown(model.aggregate.equity, model.aggregate.drawdown).map(
    (point) => ({ ...point, date: point.timestamp.slice(0, 10) }),
  );
  const money = new Intl.NumberFormat(currency === "VND" ? "vi-VN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });

  return (
    <Card className="min-w-0 max-w-full">
      <CardHeader>
        <CardTitle>Equity Curve & Drawdown</CardTitle>
        <CardDescription>Portfolio performance from immutable backtest artifacts.</CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="h-72 min-w-0" aria-label="Portfolio equity curve">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
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
                name="Equity"
                stroke="var(--primary)"
                strokeWidth={2}
                fill={`url(#${gradientId})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="h-72 min-w-0" aria-label="Portfolio drawdown">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                fontSize={11}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                fontSize={11}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [`${Number(value).toFixed(2)}%`, "Drawdown"]}
              />
              <Area
                type="monotone"
                dataKey="drawdownPct"
                name="Drawdown"
                stroke="var(--destructive)"
                fill="var(--destructive)"
                fillOpacity={0.15}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
