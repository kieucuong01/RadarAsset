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

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import { formatMoney, formatNumber, formatPercent } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/dictionary";

type BacktestLegAnalysisProps = {
  leg: BacktestResultModel["legs"][number];
  currency: "USD" | "VND";
  applying: boolean;
  applyDisabled: boolean;
  onApply: () => void;
};

function dateLabel(value: string) {
  return value.slice(0, 10);
}

function EquityChart({
  data,
  locale,
  currency,
}: {
  data: Array<{ timestamp: string; equity: number }>;
  locale: Locale;
  currency: "USD" | "VND";
}) {
  const gradientId = useId().replaceAll(":", "");
  const rows = data.map((point) => ({ ...point, date: dateLabel(point.timestamp) }));
  const moneyLabel = (value: number) => formatMoney(value, { locale, currency });
  return (
    <div
      className="h-72 min-w-0"
      aria-label={locale === "vi" ? "Đường vốn của nhánh giao dịch" : "Leg equity curve"}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={28} fontSize={11} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={68}
            fontSize={11}
            tickFormatter={(value) => moneyLabel(Number(value))}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => moneyLabel(Number(value))}
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="var(--primary)"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BacktestLegAnalysis({
  leg,
  currency,
  applying,
  applyDisabled,
  onApply,
}: BacktestLegAnalysisProps) {
  const { t, locale } = useI18n();

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle>{leg.label}</CardTitle>
            <CardDescription>
              v{leg.strategyVersion} · {formatPercent(leg.allocationBps / 100)} ·{" "}
              {locale === "vi" ? "bộ dữ liệu" : "dataset"} {leg.datasetVersionId.slice(0, 8)}
            </CardDescription>
          </div>
          <Button onClick={onApply} disabled={applyDisabled}>
            {applying
              ? t("backtest.builder.advanced.applying")
              : t("backtest.builder.advanced.apply")}
          </Button>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <EquityChart data={leg.equity} locale={locale} currency={currency} />
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            {t("backtestResults.advanced.parameters")}:{" "}
            {Object.entries(leg.strategyParameters)
              .map(
                ([key, value]) =>
                  `${key}=${typeof value === "number" ? formatNumber(value) : String(value)}`,
              )
              .join(", ")}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("backtestResults.advanced.completedTrades")}</CardTitle>
          <CardDescription>
            {t("backtestResults.advanced.completedTradesDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {leg.trades.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("backtest.builder.advanced.emptyTrades")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("backtestResults.advanced.entry")}</TableHead>
                  <TableHead>{t("backtestResults.advanced.exit")}</TableHead>
                  <TableHead className="text-right">{t("backtestResults.pnl")}</TableHead>
                  <TableHead className="text-right">
                    {t("backtestResults.tradeList.return")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leg.trades
                  .filter((trade) => "entryAt" in trade)
                  .map((trade) => (
                    <TableRow key={`${trade.entryAt}-${trade.exitAt}`}>
                      <TableCell>{dateLabel(trade.entryAt)}</TableCell>
                      <TableCell>{dateLabel(trade.exitAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(trade.realizedPnl, { locale, currency })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPercent(trade.returnPct)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
