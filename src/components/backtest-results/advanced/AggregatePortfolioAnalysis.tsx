import { useMemo } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import { advancedAnalysisAvailability } from "@/lib/backtest/result-presentation";
import { formatMoney } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

type AggregatePortfolioAnalysisProps = {
  model: BacktestResultModel;
  availability: ReturnType<typeof advancedAnalysisAvailability>;
  currency: "USD" | "VND";
};

function dateLabel(value: string) {
  return value.slice(0, 10);
}

export function AggregatePortfolioAnalysis({
  model,
  availability,
  currency,
}: AggregatePortfolioAnalysisProps) {
  const { t, locale } = useI18n();
  const componentKeys = useMemo(
    () =>
      Object.keys(model.aggregate.contribution[0]?.components ?? {}).sort((left, right) =>
        left === "cash" ? 1 : right === "cash" ? -1 : left.localeCompare(right),
      ),
    [model.aggregate.contribution],
  );
  const contributionRows = useMemo(
    () =>
      model.aggregate.contribution.map((point) => ({
        timestamp: point.timestamp,
        date: dateLabel(point.timestamp),
        ...point.components,
      })),
    [model.aggregate.contribution],
  );
  const latestContribution = model.aggregate.contribution.at(-1);
  const events = useMemo(
    () =>
      [
        ...model.aggregate.cashFlow.map((event) => ({
          timestamp: event.timestamp,
          type: t("backtestResults.advanced.contributionEvent"),
          amount: event.amount,
          detail: `Cash ${formatMoney(event.cashAmount, { locale, currency })}`,
        })),
        ...model.aggregate.rebalance.map((event) => ({
          timestamp: event.timestamp,
          type: t("backtestResults.advanced.rebalanceEvent"),
          amount: event.turnover,
          detail: `Cost ${formatMoney(event.cost, { locale, currency })}`,
        })),
      ].sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
    [currency, locale, model.aggregate.cashFlow, model.aggregate.rebalance, t],
  );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{t("backtestResults.advanced.contributionTitle")}</CardTitle>
          <CardDescription>{t("backtestResults.advanced.contributionDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {availability.contribution ? (
            <>
              <div
                className="h-72 min-w-0"
                aria-label={t("backtestResults.advanced.contributionAria")}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={contributionRows}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
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
                      width={68}
                      fontSize={11}
                      tickFormatter={(value) => formatMoney(Number(value), { locale, currency })}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value) => formatMoney(Number(value), { locale, currency })}
                    />
                    {componentKeys.map((key, index) => (
                      <Area
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stackId="portfolio"
                        stroke={
                          key === "cash" ? "var(--muted-foreground)" : COLORS[index % COLORS.length]
                        }
                        fill={key === "cash" ? "var(--muted)" : COLORS[index % COLORS.length]}
                        fillOpacity={0.7}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("backtestResults.advanced.component")}</TableHead>
                    <TableHead className="text-right">
                      {t("backtestResults.advanced.latestValue")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {componentKeys.map((key) => (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{key === "cash" ? "Cash" : key}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(latestContribution?.components[key], { locale, currency })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("backtestResults.advanced.noContribution")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("backtestResults.advanced.cashFlowTitle")}</CardTitle>
          <CardDescription>
            {model.aggregate.assumptions.rebalanceFrequency} rebalance ·{" "}
            {model.aggregate.assumptions.dividendMode} dividends · normalized FX
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("backtest.builder.advanced.emptyCashFlow")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("backtestResults.advanced.date")}</TableHead>
                  <TableHead>{t("backtestResults.advanced.event")}</TableHead>
                  <TableHead className="text-right">
                    {t("backtestResults.advanced.amountTurnover")}
                  </TableHead>
                  <TableHead>{t("backtestResults.advanced.detail")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={`${event.timestamp}-${event.type}`}>
                    <TableCell>{dateLabel(event.timestamp)}</TableCell>
                    <TableCell>{event.type}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(event.amount, { locale, currency })}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{event.detail}</TableCell>
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
