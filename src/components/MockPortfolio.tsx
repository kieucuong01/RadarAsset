"use client";

import {
  Activity,
  AlertTriangle,
  Eye,
  EyeOff,
  Minus,
  Shield,
  Sigma,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DataStatusBadge } from "@/components/DataStatusBadge";
import { FavoriteAssetsPanel } from "@/components/FavoriteAssetsPanel";
import { PortfolioTransactionDialog } from "@/components/PortfolioTransactionDialog";
import { StrategyAssignmentPanel } from "@/components/StrategyAssignmentPanel";
import { PortfolioStrategyForwardTests } from "@/components/PortfolioStrategyForwardTests";
import { Button } from "@/components/ui/button";
import type {
  PortfolioHoldingResponse,
  PortfolioResponse,
  PortfolioRiskMetricResponse,
  PortfolioTimeframe,
} from "@/lib/backend/types";
import { useI18n } from "@/lib/i18n/context";

const TIMEFRAMES = ["1W", "1M", "YTD", "1Y"] as const;
type Timeframe = PortfolioTimeframe;

const allocationColors: Record<string, string> = {
  Crypto: "var(--primary)",
  Stocks: "var(--bull)",
  Cash: "var(--muted-foreground)",
};

const riskIcons: Record<PortfolioRiskMetricResponse["key"], typeof Activity> = {
  beta: Activity,
  sharpe: Target,
  volatility: Sigma,
  maxDrawdown: TrendingDown,
  var95: AlertTriangle,
  diversification: Shield,
};

type Tx = {
  id: string;
  date: string;
  ticker: string;
  side: "Buy" | "Sell";
  qty: number;
  price: number;
  fee: number;
  netAmount: number;
  realizedPnL: number;
};

export function MockPortfolio() {
  const { t } = useI18n();
  const [hide, setHide] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPortfolio = async (nextTimeframe = timeframe) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolio?timeframe=${nextTimeframe}`, { cache: "no-store" });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Portfolio API unavailable");
      }
      setPortfolio((await res.json()) as PortfolioResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load portfolio.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPortfolio(timeframe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  const allocationData = useMemo(
    () => portfolio?.allocation.map((item) => ({ name: item.category, value: item.value })) ?? [],
    [portfolio],
  );

  const totalValue = portfolio?.totalValue ?? 0;
  const totalCost = portfolio?.totalCost ?? 0;
  const unrealizedPnL = portfolio?.unrealizedPnL ?? 0;
  const realizedPnL = portfolio?.realizedPnL ?? 0;
  const totalPnL = portfolio?.totalPnL ?? 0;
  const totalPnLPct = portfolio?.totalPnLPct ?? 0;
  const day = portfolio?.dayChangePct ?? 0;
  const holdings = portfolio?.holdings ?? [];
  const performance = portfolio?.performance ?? [];

  const fmt0 = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const fmt2 = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

  if (loading && !portfolio) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <PortfolioHeader portfolio={null} />
        <StatusPanel title={t("portfolio.states.loadingTitle")} tone="muted">
          {t("portfolio.states.loadingBody")}
        </StatusPanel>
      </main>
    );
  }

  if (error && !portfolio) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <PortfolioHeader portfolio={null} />
        <StatusPanel title={t("portfolio.states.backendUnavailable")} tone="bear">
          {error}
          <div className="mt-4">
            <Button onClick={() => void loadPortfolio()}>{t("common.retry")}</Button>
          </div>
        </StatusPanel>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <PortfolioHeader portfolio={portfolio} />

      {error && (
        <StatusPanel title={t("portfolio.states.usingSnapshot")} tone="bear">
          {error}
        </StatusPanel>
      )}

      <section className="grid lg:grid-cols-2 gap-6" aria-labelledby="overview-heading">
        <h2 id="overview-heading" className="sr-only">
          {t("portfolio.header.title")}
        </h2>

        <div className="space-y-6">
          <div className="rounded-2xl p-7 border border-border bg-card shadow-elegant">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {t("portfolio.balance.total")}
              <button
                onClick={() => setHide(!hide)}
                className="hover:text-foreground"
                aria-label={t("portfolio.balance.toggle")}
              >
                {hide ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="mt-2 text-5xl md:text-6xl font-bold tracking-tight tabular-nums">
              {hide ? "******" : fmt0(totalValue)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-full ${
                  day >= 0 ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                }`}
              >
                {day >= 0 ? (
                  <TrendingUp className="w-3.5 h-3.5" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5" />
                )}
                {day >= 0 ? "+" : ""}
                {day.toFixed(2)}% 24h
              </span>
              <span className="text-xs text-muted-foreground">
                {t("portfolio.balance.totalPnl")}:{" "}
                <span className={totalPnL >= 0 ? "text-bull" : "text-bear"}>
                  {totalPnL >= 0 ? "+" : ""}
                  {fmt0(totalPnL)} ({totalPnLPct.toFixed(2)}%)
                </span>
              </span>
            </div>
            <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {t("portfolio.balance.openCost")}
                </div>
                <div className="mt-1 font-semibold tabular-nums">
                  {hide ? "******" : fmt0(totalCost)}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {t("portfolio.balance.unrealized")}
                </div>
                <div
                  className={`mt-1 font-semibold tabular-nums ${
                    unrealizedPnL >= 0 ? "text-bull" : "text-bear"
                  }`}
                >
                  {hide ? "******" : `${unrealizedPnL >= 0 ? "+" : ""}${fmt0(unrealizedPnL)}`}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {t("portfolio.balance.realized")}
                </div>
                <div
                  className={`mt-1 font-semibold tabular-nums ${
                    realizedPnL >= 0 ? "text-bull" : "text-bear"
                  }`}
                >
                  {hide ? "******" : `${realizedPnL >= 0 ? "+" : ""}${fmt0(realizedPnL)}`}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl p-6 border border-border bg-card">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{t("portfolio.allocation.title")}</h2>
              <span className="text-xs text-muted-foreground">
                {t("portfolio.allocation.byCategory")}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] items-center gap-4">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={allocationData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={95}
                      paddingAngle={3}
                      stroke="var(--card)"
                      strokeWidth={3}
                    >
                      {allocationData.map((d) => (
                        <Cell key={d.name} fill={allocationColors[d.name] ?? "var(--primary)"} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number) => [`${v}%`, t("portfolio.allocation.tooltip")]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-3 pr-2">
                {allocationData.map((d) => (
                  <li key={d.name} className="flex items-center gap-3 text-sm">
                    <span
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: allocationColors[d.name] ?? "var(--primary)" }}
                    />
                    <span className="text-muted-foreground w-16">{d.name}</span>
                    <span className="font-semibold tabular-nums">{d.value}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="rounded-2xl p-6 border border-border bg-card flex flex-col">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold">{t("portfolio.performance.title")}</h2>
              <p className="text-xs text-muted-foreground mt-1">
                {t("portfolio.performance.description")}
              </p>
            </div>
            <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-1">
              {TIMEFRAMES.map((item) => (
                <button
                  key={item}
                  onClick={() => setTimeframe(item)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    timeframe === item
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-6 text-xs">
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-primary" /> {t("common.portfolio")}
            </span>
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground" /> SPY
            </span>
          </div>

          <div className="flex-1 mt-4 min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={performance} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gPort" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gBench" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--muted-foreground)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
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
                  dataKey="Portfolio"
                  stroke="var(--primary)"
                  strokeWidth={2.2}
                  fill="url(#gPort)"
                />
                <Area
                  type="monotone"
                  dataKey="Benchmark"
                  stroke="var(--muted-foreground)"
                  strokeWidth={1.8}
                  strokeDasharray="4 3"
                  fill="url(#gBench)"
                />
                <Legend wrapperStyle={{ display: "none" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <HoldingsTable holdings={holdings} fmt0={fmt0} fmt2={fmt2} />
      <FavoriteAssetsPanel holdings={holdings} timeframe={timeframe} onRecorded={setPortfolio} />
      <RiskMetrics metrics={portfolio?.riskMetrics ?? []} />
      <StrategyAssignmentPanel
        holdings={holdings}
        disabled={!portfolio}
        timeframe={timeframe}
        onRecorded={setPortfolio}
      />
      <PortfolioStrategyForwardTests />
      <TransactionLog
        transactions={portfolio?.transactions ?? []}
        holdings={holdings}
        disabled={!portfolio}
        timeframe={timeframe}
        fmt2={fmt2}
        onRecorded={setPortfolio}
      />
    </main>
  );
}

function PortfolioHeader({ portfolio }: { portfolio: PortfolioResponse | null }) {
  const { t } = useI18n();
  const asOf = portfolio?.dataAsOf
    ? new Date(portfolio.dataAsOf).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : t("portfolio.header.notLoaded");

  return (
    <header className="space-y-2">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            {t("portfolio.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("portfolio.header.description")}</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <DataStatusBadge status="SIMULATED" detail={t("portfolio.header.simulatedDetail")} />
          <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <div className="font-mono uppercase tracking-wider">
              {t("portfolio.header.dataSource")}
            </div>
            <div className="mt-1 text-foreground">
              {portfolio?.dataSource ?? "local"} - {asOf}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function StatusPanel({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "muted" | "bear";
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border p-6 ${
        tone === "bear" ? "border-bear/30 bg-bear/5" : "border-border bg-card"
      }`}
    >
      <h2 className={`font-semibold ${tone === "bear" ? "text-bear" : ""}`}>{title}</h2>
      <div className="text-sm text-muted-foreground mt-1">{children}</div>
    </div>
  );
}

function HoldingsTable({
  holdings,
  fmt0,
  fmt2,
}: {
  holdings: NonNullable<PortfolioResponse["holdings"]>;
  fmt0: (n: number) => string;
  fmt2: (n: number) => string;
}) {
  const { t } = useI18n();
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="p-5 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{t("portfolio.holdings.title")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("portfolio.holdings.description")}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {t("portfolio.holdings.count", { count: holdings.length })}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left font-medium px-5 py-3">{t("portfolio.holdings.asset")}</th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.holdings.quantity")}
              </th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.holdings.averageCost")}
              </th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.holdings.currentPrice")}
              </th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.holdings.totalValue")}
              </th>
              <th className="text-left font-medium px-5 py-3 min-w-[200px]">
                {t("portfolio.holdings.allocation")}
              </th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.holdings.unrealizedPnl")}
              </th>
              <th className="text-center font-medium px-5 py-3">
                {t("portfolio.holdings.signal")}
              </th>
            </tr>
          </thead>
          <tbody>
            {holdings.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                  {t("portfolio.holdings.empty")}
                </td>
              </tr>
            )}
            {holdings.map((holding) => {
              const up = holding.pnl >= 0;
              return (
                <tr
                  key={holding.ticker}
                  className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-primary text-primary-foreground grid place-items-center text-xs font-bold">
                        {holding.ticker.slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-semibold">{holding.name}</div>
                        <div className="text-xs text-muted-foreground">{holding.ticker}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-right tabular-nums px-5 py-4">
                    {holding.qty.toLocaleString("en-US", { maximumFractionDigits: 8 })}
                  </td>
                  <td className="text-right tabular-nums px-5 py-4">{fmt2(holding.cost)}</td>
                  <td className="text-right tabular-nums px-5 py-4">
                    {holding.price.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="text-right tabular-nums px-5 py-4 font-medium">
                    {fmt0(holding.value)}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold tabular-nums w-10">
                        {holding.alloc}%
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-gradient-primary"
                          style={{ width: `${holding.alloc}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="text-right px-5 py-4">
                    <div className={`font-semibold tabular-nums ${up ? "text-bull" : "text-bear"}`}>
                      {up ? "+" : ""}
                      {fmt0(holding.pnl)}
                    </div>
                    <div className={`text-xs tabular-nums ${up ? "text-bull" : "text-bear"}`}>
                      {up ? "+" : ""}
                      {holding.pnlPct.toFixed(2)}%
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-center">
                      <SentimentBadge sentiment={holding.sentiment} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RiskMetrics({ metrics }: { metrics: PortfolioRiskMetricResponse[] }) {
  const { t } = useI18n();
  return (
    <section className="space-y-3" aria-labelledby="risk-metrics-heading">
      <div className="flex items-end justify-between">
        <div>
          <h2 id="risk-metrics-heading" className="font-semibold">
            {t("portfolio.risk.title")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t("portfolio.risk.description")}</p>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {t("portfolio.risk.source")}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            {t("portfolio.risk.empty")}
          </div>
        )}
        {metrics.map((metric) => {
          const Icon = riskIcons[metric.key];
          return (
            <div key={metric.key} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                  {metric.label}
                </div>
                <Icon
                  className={`w-3.5 h-3.5 ${
                    metric.tone === "bull"
                      ? "text-bull"
                      : metric.tone === "bear"
                        ? "text-bear"
                        : "text-primary"
                  }`}
                />
              </div>
              <div
                className={`mt-1.5 text-xl font-bold tabular-nums ${
                  metric.tone === "bull"
                    ? "text-bull"
                    : metric.tone === "bear"
                      ? "text-bear"
                      : "text-foreground"
                }`}
              >
                {metric.value}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{metric.sub}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TransactionLog({
  transactions,
  holdings,
  disabled,
  timeframe,
  fmt2,
  onRecorded,
}: {
  transactions: PortfolioResponse["transactions"];
  holdings: PortfolioHoldingResponse[];
  disabled: boolean;
  timeframe: PortfolioTimeframe;
  fmt2: (n: number) => string;
  onRecorded: (portfolio: PortfolioResponse) => void;
}) {
  const { t } = useI18n();
  const visibleTxs = useMemo<Tx[]>(
    () =>
      transactions.map((transaction) => ({
        id: transaction.id ?? `${transaction.assetId}-${transaction.executedAt}`,
        date: transaction.executedAt.slice(0, 10),
        ticker: transaction.symbol ?? transaction.assetId.slice(0, 6),
        side: transaction.type === "buy" ? "Buy" : "Sell",
        qty: transaction.quantity,
        price: transaction.price,
        fee: transaction.fee,
        netAmount: transaction.netAmount,
        realizedPnL: transaction.realizedPnL,
      })),
    [transactions],
  );

  return (
    <section
      className="rounded-2xl border border-border bg-card overflow-hidden"
      aria-labelledby="txlog-heading"
    >
      <div className="p-5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 id="txlog-heading" className="font-semibold">
            {t("portfolio.transactions.title")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("portfolio.transactions.description")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t("portfolio.transactions.count", { count: visibleTxs.length })}
          </span>
          <PortfolioTransactionDialog
            holdings={holdings}
            disabled={disabled}
            timeframe={timeframe}
            onRecorded={onRecorded}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left font-medium px-5 py-3">
                {t("portfolio.transactions.date")}
              </th>
              <th className="text-left font-medium px-5 py-3">{t("common.asset")}</th>
              <th className="text-center font-medium px-5 py-3">
                {t("portfolio.transactions.side")}
              </th>
              <th className="text-right font-medium px-5 py-3">{t("common.quantity")}</th>
              <th className="text-right font-medium px-5 py-3">{t("common.price")}</th>
              <th className="text-right font-medium px-5 py-3">{t("common.fee")}</th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.transactions.netAmount")}
              </th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.transactions.realizedPnl")}
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleTxs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                  {t("portfolio.transactions.empty")}
                </td>
              </tr>
            )}
            {visibleTxs.map((tx) => {
              const isBuy = tx.side === "Buy";
              return (
                <tr
                  key={tx.id}
                  className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                >
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{tx.date}</td>
                  <td className="px-5 py-3 font-semibold">{tx.ticker}</td>
                  <td className="px-5 py-3 text-center">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        isBuy ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                      }`}
                    >
                      {isBuy ? t("common.buy") : t("common.sell")}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{tx.qty.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{fmt2(tx.price)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {tx.fee ? fmt2(tx.fee) : "-"}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums font-semibold">
                    {tx.netAmount >= 0 ? "+" : ""}
                    {fmt2(tx.netAmount)}
                  </td>
                  <td
                    className={`px-5 py-3 text-right tabular-nums font-semibold ${
                      !isBuy && tx.realizedPnL >= 0 ? "text-bull" : !isBuy ? "text-bear" : ""
                    }`}
                  >
                    {isBuy ? "–" : `${tx.realizedPnL >= 0 ? "+" : ""}${fmt2(tx.realizedPnL)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SentimentBadge({ sentiment }: { sentiment: "Bullish" | "Bearish" | "Neutral" }) {
  const map = {
    Bullish: { cls: "bg-bull/15 text-bull", Icon: TrendingUp },
    Bearish: { cls: "bg-bear/15 text-bear", Icon: TrendingDown },
    Neutral: { cls: "bg-muted text-muted-foreground", Icon: Minus },
  } as const;
  const { cls, Icon } = map[sentiment];
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${cls}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {sentiment}
    </span>
  );
}
