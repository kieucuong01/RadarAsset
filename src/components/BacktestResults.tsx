"use client";

import { useMemo, useState } from "react";
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
import { buildBacktestResultModel } from "@/lib/backtest/result-model";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: unknown) {
  return `${number(value).toFixed(2)}%`;
}

function dateLabel(value: string) {
  return value.slice(0, 10);
}

function EquityChart({ data }: { data: Array<{ timestamp: string; equity: number }> }) {
  const rows = data.map((point) => ({ ...point, date: dateLabel(point.timestamp) }));
  return (
    <div className="h-72 min-w-0" aria-label="Equity curve">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="backtest-equity" x1="0" y1="0" x2="0" y2="1">
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
            fill="url(#backtest-equity)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BacktestResults({ run }: { run: BacktestRun }) {
  const model = useMemo(() => buildBacktestResultModel(run), [run]);
  const [applyingLegId, setApplyingLegId] = useState<string | null>(null);
  const currency = model.aggregate.assumptions.baseCurrency;
  const componentKeys = Object.keys(model.aggregate.contribution[0]?.components ?? {}).sort(
    (left, right) => (left === "cash" ? 1 : right === "cash" ? -1 : left.localeCompare(right)),
  );
  const contributionRows = model.aggregate.contribution.map((point) => ({
    timestamp: point.timestamp,
    date: dateLabel(point.timestamp),
    ...point.components,
  }));
  const latestContribution = model.aggregate.contribution.at(-1);
  const events = [
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
  ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  async function applyStrategy(leg: (typeof model.legs)[number]) {
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
    <section className="min-w-0 space-y-5" aria-labelledby="backtest-results-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="backtest-results-heading" className="text-xl font-semibold">
            Kết quả Portfolio Backtest
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Mô phỏng vốn chuẩn hóa; không phải sao kê môi giới hay khuyến nghị đầu tư.
          </p>
        </div>
        <Badge variant="secondary">{run.engineVersion}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Final equity", money(number(model.aggregate.metrics.finalEquity), currency)],
          ["Net return", percent(model.aggregate.metrics.totalReturnPct)],
          ["Max drawdown", percent(model.aggregate.metrics.maxDrawdownPct)],
          ["Rebalance cost", money(number(model.aggregate.metrics.rebalanceCost), currency)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="pt-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {model.aggregate.analytics ? (
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

        <TabsContent value="aggregate" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{model.aggregate.label}</CardTitle>
              <CardDescription>
                Aggregate equity after contributions, rebalancing and costs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EquityChart data={model.aggregate.equity} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contribution by asset and cash</CardTitle>
              <CardDescription>
                Absolute sleeve values stacked to total portfolio equity.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-72 min-w-0" aria-label="Portfolio contribution chart">
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
                    <TableHead>Component</TableHead>
                    <TableHead className="text-right">Latest value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {componentKeys.map((key) => (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{key === "cash" ? "Cash" : key}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(latestContribution?.components[key] ?? 0, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
          <TabsContent key={leg.id} value={leg.id} className="space-y-5">
            <Card>
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
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
              <CardContent className="space-y-4">
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
                      {leg.trades.map((trade) => (
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
    </section>
  );
}
