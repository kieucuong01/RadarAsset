"use client";

import { useId, useMemo, useState } from "react";
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
import { advancedAnalysisAvailability } from "@/lib/backtest/result-presentation";

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
          type: "Contribution",
          amount: event.amount,
          detail: `Cash ${money(event.cashAmount, currency)}`,
        })),
        ...model.aggregate.rebalance.map((event) => ({
          timestamp: event.timestamp,
          type: "Rebalance",
          amount: event.turnover,
          detail: `Cost ${money(event.cost, currency)}`,
        })),
      ].sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
    [currency, model.aggregate.cashFlow, model.aggregate.rebalance],
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
        throw new Error(payload?.error ?? "Không thể áp dụng chiến lược vào Mock Portfolio.");
      }
      toast.success(`Đã áp dụng ${leg.strategyCode} cho ${leg.symbol}. Tín hiệu vẫn cần xác nhận.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể áp dụng chiến lược.");
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
      <summary className="cursor-pointer px-6 py-5 font-semibold">Advanced Analysis</summary>
      <div className="flex min-w-0 flex-col gap-5 px-6 pb-6">
        <div className="flex flex-wrap gap-2" aria-label="Available advanced analysis">
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
              <CardTitle>QuantStats IS / OOS report</CardTitle>
              <CardDescription>
                Chronological 70/30 split with market-aware annualization. The HTML tear sheet is
                downloaded instead of rendered inside the app.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                Source: QuantStats · immutable run artifact
              </span>
              <Button onClick={downloadQuantStatsReport} disabled={!model.aggregate.reportHtml}>
                Download HTML report
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {model.aggregate.robustness ? (
          <Card>
            <CardHeader>
              <CardTitle>Temporal holdout &amp; overfitting checks</CardTitle>
              <CardDescription>
                Expanding chronological windows. Each out-of-sample segment uses only information
                available before that segment.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">OOS mean return</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {model.aggregate.robustness.outOfSampleMeanReturnPct.toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">Positive folds</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {model.aggregate.robustness.outOfSamplePositiveFoldPct.toFixed(0)}%
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">OOS dispersion</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {model.aggregate.robustness.outOfSampleReturnStdPct.toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">Sample</p>
                  <p className="mt-1 text-xl font-semibold capitalize">
                    {model.aggregate.robustness.sampleAdequacy}
                  </p>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fold</TableHead>
                    <TableHead>Out-of-sample period</TableHead>
                    <TableHead className="text-right">Reference return</TableHead>
                    <TableHead className="text-right">OOS return</TableHead>
                    <TableHead className="text-right">Degradation</TableHead>
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
                <p className="font-medium">Parameter robustness</p>
                <p className="mt-1 text-muted-foreground">
                  {model.aggregate.robustness.parameterStability.status === "not_evaluated"
                    ? "Not evaluated: this run did not execute neighboring parameter sets."
                    : `${model.aggregate.robustness.parameterStability.status} · score ${model.aggregate.robustness.parameterStability.score?.toFixed(1) ?? "—"}/100`}
                </p>
                {model.aggregate.robustness.warnings.length > 0 ? (
                  <p className="mt-2 text-amber-600 dark:text-amber-400">
                    Warnings: {model.aggregate.robustness.warnings.join(", ")}
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
              <TabsTrigger value="aggregate">Portfolio</TabsTrigger>
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
                <CardTitle>Contribution by asset and cash</CardTitle>
                <CardDescription>
                  Absolute sleeve values stacked to total portfolio equity.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex min-w-0 flex-col gap-4">
                {availability.contribution ? (
                  <>
                    <div className="h-72 min-w-0" aria-label="Portfolio contribution chart">
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
                          <TableHead>Component</TableHead>
                          <TableHead className="text-right">Latest value</TableHead>
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
                    No contribution artifact is available for this run.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cash-flow and rebalance events</CardTitle>
                <CardDescription>
                  {model.aggregate.assumptions.rebalanceFrequency} rebalance ·{" "}
                  {model.aggregate.assumptions.dividendMode} dividends · normalized FX
                </CardDescription>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Không có dòng tiền hoặc tái cân bằng trong kỳ.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead className="text-right">Amount / turnover</TableHead>
                        <TableHead>Detail</TableHead>
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
                    {applyingLegId === leg.id ? "Đang áp dụng…" : "Apply vào Mock Portfolio"}
                  </Button>
                </CardHeader>
                <CardContent className="flex min-w-0 flex-col gap-4">
                  <EquityChart data={leg.equity} />
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                    Parameters:{" "}
                    {Object.entries(leg.strategyParameters)
                      .map(([key, value]) => `${key}=${String(value)}`)
                      .join(", ")}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Completed trades</CardTitle>
                  <CardDescription>Signal at close, fill at next bar open.</CardDescription>
                </CardHeader>
                <CardContent>
                  {leg.trades.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Không có giao dịch hoàn tất trong kỳ.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Entry</TableHead>
                          <TableHead>Exit</TableHead>
                          <TableHead className="text-right">PnL</TableHead>
                          <TableHead className="text-right">Return</TableHead>
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
