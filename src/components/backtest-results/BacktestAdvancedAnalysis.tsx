"use client";

import { useId, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { normalizeStrategyAssignment } from "@/lib/backtest/assignment-contracts";
import type { BacktestRun } from "@/lib/backtest/client";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import { advancedAnalysisAvailability, robustnessStatus } from "@/lib/backtest/result-presentation";
import { useI18n } from "@/lib/i18n/context";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

type BacktestAdvancedAnalysisProps = {
  run: BacktestRun;
  model: BacktestResultModel;
  currency: "USD" | "VND";
};

function money(value: number, currency: "USD" | "VND") {
  return new Intl.NumberFormat(currency === "VND" ? "vi-VN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(value);
}

function dateLabel(value: string) {
  return value.slice(0, 10);
}

function EquityChart({ data }: { data: Array<{ timestamp: string; equity: number }> }) {
  const gradientId = useId().replaceAll(":", "");
  const rows = data.map((point) => ({ ...point, date: dateLabel(point.timestamp) }));
  return (
    <div className="h-72 min-w-0" aria-label="Leg equity curve">
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
          <YAxis tickLine={false} axisLine={false} width={68} fontSize={11} />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
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

export function BacktestAdvancedAnalysis({ run, model, currency }: BacktestAdvancedAnalysisProps) {
  const [applyingLegId, setApplyingLegId] = useState<string | null>(null);
  const availability = advancedAnalysisAvailability(model);
  const { t } = useI18n();
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
          detail: `Cash ${money(event.cashAmount, currency)}`,
        })),
        ...model.aggregate.rebalance.map((event) => ({
          timestamp: event.timestamp,
          type: t("backtestResults.advanced.rebalanceEvent"),
          amount: event.turnover,
          detail: `Cost ${money(event.cost, currency)}`,
        })),
      ].sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
    [currency, model.aggregate.cashFlow, model.aggregate.rebalance, t],
  );

  async function applyStrategy(leg: BacktestResultModel["legs"][number]) {
    setApplyingLegId(leg.id);
    try {
      const input = normalizeStrategyAssignment({
        symbol: leg.symbol,
        strategyCode: leg.strategyCode,
        strategyVersion: leg.strategyVersion,
        strategyParameters: leg.strategyParameters,
        backtestRunId: run.id,
        backtestRunLegId: leg.id,
      });
      const response = await fetch("/api/portfolio/strategy-assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? t("backtest.builder.advanced.applyError"));
      }
      toast.success(
        t("backtest.builder.advanced.applySuccess", {
          strategy: leg.strategyCode,
          symbol: leg.symbol,
        }),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("backtest.builder.advanced.applyError"),
      );
    } finally {
      setApplyingLegId(null);
    }
  }

  function downloadQuantStatsReport() {
    if (!model.aggregate.reportHtml) return;
    const url = URL.createObjectURL(new Blob([model.aggregate.reportHtml], { type: "text/html" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `quantstats-${run.id.slice(0, 8)}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <details className="min-w-0 max-w-full rounded-xl border bg-card text-card-foreground shadow">
      <summary className="cursor-pointer px-6 py-5 font-semibold">
        {t("backtestResults.advanced.title")}
      </summary>
      <div className="flex min-w-0 flex-col gap-5 px-6 pb-6">
        {model.aggregate.historicalCoverage?.warningCode === "SURVIVORSHIP_COVERAGE_PARTIAL" ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>{t("backtestResults.advanced.survivorshipTitle")}</AlertTitle>
            <AlertDescription>
              {t("backtestResults.advanced.survivorshipDescription", {
                date: model.aggregate.historicalCoverage.firstObservedAt?.slice(0, 10) ?? "—",
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        <div
          className="flex flex-wrap gap-2"
          aria-label={t("backtestResults.advanced.availableAria")}
        >
          {Object.entries(availability)
            .filter(([, available]) => available)
            .map(([section]) => (
              <Badge key={section} variant="secondary">
                {section}
              </Badge>
            ))}
        </div>

        {availability.quantStats ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("backtestResults.advanced.reportTitle")}</CardTitle>
              <CardDescription>{t("backtestResults.advanced.reportDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {t("backtestResults.advanced.source")}
              </span>
              <Button onClick={downloadQuantStatsReport} disabled={!model.aggregate.reportHtml}>
                {t("backtestResults.advanced.download")}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {model.aggregate.robustness ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("backtestResults.advanced.holdoutTitle")}</CardTitle>
              <CardDescription>{t("backtestResults.advanced.holdoutDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Badge
                variant={
                  robustnessStatus(model.aggregate.robustness) === "fragile"
                    ? "destructive"
                    : "secondary"
                }
                className="w-fit uppercase"
              >
                {robustnessStatus(model.aggregate.robustness)}
              </Badge>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">
                    {t("backtestResults.advanced.oosMean")}
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {model.aggregate.robustness.outOfSampleMeanReturnPct.toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">
                    {t("backtestResults.advanced.positiveFolds")}
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {model.aggregate.robustness.outOfSamplePositiveFoldPct.toFixed(0)}%
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">
                    {t("backtestResults.advanced.oosDispersion")}
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {model.aggregate.robustness.outOfSampleReturnStdPct.toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">
                    {t("backtestResults.advanced.sample")}
                  </p>
                  <p className="mt-1 text-xl font-semibold capitalize">
                    {model.aggregate.robustness.sampleAdequacy}
                  </p>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("backtestResults.advanced.fold")}</TableHead>
                    <TableHead>{t("backtestResults.advanced.oosPeriod")}</TableHead>
                    <TableHead className="text-right">
                      {t("backtestResults.advanced.referenceReturn")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("backtestResults.advanced.oosReturn")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("backtestResults.advanced.degradation")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.aggregate.robustness.folds.map((fold) => (
                    <TableRow key={fold.fold}>
                      <TableCell>{fold.fold}</TableCell>
                      <TableCell>
                        {dateLabel(fold.testStart)} → {dateLabel(fold.testEnd)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fold.referenceReturnPct.toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fold.outOfSampleReturnPct.toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fold.degradationPctPoints.toFixed(2)} pp
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{t("backtestResults.advanced.parameterRobustness")}</p>
                <p className="mt-1 text-muted-foreground">
                  {model.aggregate.robustness.parameterStability.status === "not_evaluated"
                    ? "Not evaluated: this run did not execute neighboring parameter sets."
                    : `${model.aggregate.robustness.parameterStability.status} · score ${model.aggregate.robustness.parameterStability.score?.toFixed(1) ?? "—"}/100`}
                </p>
                {model.aggregate.robustness.warnings.length > 0 ? (
                  <p className="mt-2 text-amber-600 dark:text-amber-400">
                    {t("backtestResults.advanced.warnings")}:{" "}
                    {model.aggregate.robustness.warnings.join(", ")}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {model.aggregate.robustness.disclaimer}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Tabs defaultValue="aggregate" className="min-w-0">
          <div className="max-w-full overflow-x-auto pb-1">
            <TabsList className="w-max justify-start">
              <TabsTrigger value="aggregate">{t("backtestResults.advanced.aggregate")}</TabsTrigger>
              {model.legs.map((leg) => (
                <TabsTrigger key={leg.id} value={leg.id}>
                  {leg.symbol}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="aggregate" className="flex min-w-0 flex-col gap-5">
            <Card>
              <CardHeader>
                <CardTitle>{t("backtestResults.advanced.contributionTitle")}</CardTitle>
                <CardDescription>
                  {t("backtestResults.advanced.contributionDescription")}
                </CardDescription>
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
                          <CartesianGrid
                            vertical={false}
                            stroke="var(--border)"
                            strokeDasharray="3 3"
                          />
                          <XAxis
                            dataKey="date"
                            tickLine={false}
                            axisLine={false}
                            minTickGap={28}
                            fontSize={11}
                          />
                          <YAxis tickLine={false} axisLine={false} width={68} fontSize={11} />
                          <Tooltip
                            contentStyle={{
                              background: "var(--card)",
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                          />
                          {componentKeys.map((key, index) => (
                            <Area
                              key={key}
                              type="monotone"
                              dataKey={key}
                              stackId="portfolio"
                              stroke={
                                key === "cash"
                                  ? "var(--muted-foreground)"
                                  : COLORS[index % COLORS.length]
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
                            <TableCell className="font-medium">
                              {key === "cash" ? "Cash" : key}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {money(latestContribution?.components[key] ?? 0, currency)}
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
                            {money(event.amount, currency)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{event.detail}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {model.legs.map((leg) => (
            <TabsContent key={leg.id} value={leg.id} className="flex min-w-0 flex-col gap-5">
              <Card>
                <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <CardTitle>{leg.label}</CardTitle>
                    <CardDescription>
                      v{leg.strategyVersion} · {(leg.allocationBps / 100).toFixed(2)}% · dataset{" "}
                      {leg.datasetVersionId.slice(0, 8)}
                    </CardDescription>
                  </div>
                  <Button onClick={() => void applyStrategy(leg)} disabled={applyingLegId !== null}>
                    {applyingLegId === leg.id
                      ? t("backtest.builder.advanced.applying")
                      : t("backtest.builder.advanced.apply")}
                  </Button>
                </CardHeader>
                <CardContent className="flex min-w-0 flex-col gap-4">
                  <EquityChart data={leg.equity} />
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                    {t("backtestResults.advanced.parameters")}:{" "}
                    {Object.entries(leg.strategyParameters)
                      .map(([key, value]) => `${key}=${String(value)}`)
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
                                {money(trade.realizedPnl, currency)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {trade.returnPct.toFixed(2)}%
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </details>
  );
}
