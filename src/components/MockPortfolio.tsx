"use client";

import {
  Activity,
  AlertTriangle,
  Eye,
  EyeOff,
  Minus,
  Plus,
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
import { toast } from "sonner";
import { DataStatusBadge } from "@/components/DataStatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PortfolioResponse, PortfolioRiskMetricResponse } from "@/lib/backend/types";

const TIMEFRAMES = ["1W", "1M", "YTD", "1Y"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

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
};

export function MockPortfolio() {
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
        <StatusPanel title="Loading portfolio" tone="muted">
          Loading portfolio, marks and risk metrics from local PostgreSQL.
        </StatusPanel>
      </main>
    );
  }

  if (error && !portfolio) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <PortfolioHeader portfolio={null} />
        <StatusPanel title="Portfolio backend unavailable" tone="bear">
          {error}
          <div className="mt-4">
            <Button onClick={() => void loadPortfolio()}>Retry</Button>
          </div>
        </StatusPanel>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <PortfolioHeader portfolio={portfolio} />

      {error && (
        <StatusPanel title="Using last loaded snapshot" tone="bear">
          {error}
        </StatusPanel>
      )}

      <section className="grid lg:grid-cols-2 gap-6" aria-labelledby="overview-heading">
        <h2 id="overview-heading" className="sr-only">
          Portfolio overview
        </h2>

        <div className="space-y-6">
          <div className="rounded-2xl p-7 border border-border bg-card shadow-elegant">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              Total Balance
              <button
                onClick={() => setHide(!hide)}
                className="hover:text-foreground"
                aria-label="toggle balance"
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
                Total PnL:{" "}
                <span className={totalPnL >= 0 ? "text-bull" : "text-bear"}>
                  {totalPnL >= 0 ? "+" : ""}
                  {fmt0(totalPnL)} ({totalPnLPct.toFixed(2)}%)
                </span>
              </span>
            </div>
          </div>

          <div className="rounded-2xl p-6 border border-border bg-card">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Asset Allocation</h2>
              <span className="text-xs text-muted-foreground">By category</span>
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
                      formatter={(v: number) => [`${v}%`, "Allocation"]}
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
              <h2 className="font-semibold">Performance vs Benchmark</h2>
              <p className="text-xs text-muted-foreground mt-1">Portfolio compared to SPY</p>
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
              <span className="w-2.5 h-2.5 rounded-full bg-primary" /> Portfolio
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

      <HoldingsTable holdings={holdings} fmt0={fmt0} />
      <RiskMetrics metrics={portfolio?.riskMetrics ?? []} />
      <TransactionLog
        transactions={portfolio?.transactions ?? []}
        disabled={!portfolio}
        fmt2={fmt2}
        onRecorded={setPortfolio}
      />
    </main>
  );
}

function PortfolioHeader({ portfolio }: { portfolio: PortfolioResponse | null }) {
  const asOf = portfolio?.dataAsOf
    ? new Date(portfolio.dataAsOf).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not loaded";

  return (
    <header className="space-y-2">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Danh mục mô phỏng – Phân tích tài sản
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            DB-backed multi-asset analytics with PnL, allocation, risk, transaction accounting and
            benchmark performance.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <DataStatusBadge
            status="SIMULATED"
            detail="Danh mục demo được lưu trong PostgreSQL; không phải tài khoản môi giới thực."
          />
          <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <div className="font-mono uppercase tracking-wider">Data source</div>
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
}: {
  holdings: NonNullable<PortfolioResponse["holdings"]>;
  fmt0: (n: number) => string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="p-5 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Smart Holdings</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Marked from latest local OHLCV and enriched with portfolio analytics.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{holdings.length} assets</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left font-medium px-5 py-3">Asset</th>
              <th className="text-right font-medium px-5 py-3">Current Price</th>
              <th className="text-right font-medium px-5 py-3">Total Value</th>
              <th className="text-left font-medium px-5 py-3 min-w-[200px]">Allocation</th>
              <th className="text-right font-medium px-5 py-3">Unrealized PnL</th>
              <th className="text-center font-medium px-5 py-3">Signal</th>
            </tr>
          </thead>
          <tbody>
            {holdings.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                  No portfolio positions found.
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
  return (
    <section className="space-y-3" aria-labelledby="risk-metrics-heading">
      <div className="flex items-end justify-between">
        <div>
          <h2 id="risk-metrics-heading" className="font-semibold">
            Risk Metrics
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Quantitative measures calculated from portfolio marks and benchmark returns.
          </p>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          PostgreSQL derived
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            Risk metrics need portfolio performance data.
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
  disabled,
  fmt2,
  onRecorded,
}: {
  transactions: PortfolioResponse["transactions"];
  disabled: boolean;
  fmt2: (n: number) => string;
  onRecorded: (portfolio: PortfolioResponse) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    ticker: "BTC",
    side: "Buy" as "Buy" | "Sell",
    qty: "",
    price: "",
    fee: "0",
    date: new Date().toISOString().slice(0, 10),
  });

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
      })),
    [transactions],
  );

  const submit = async () => {
    const qty = Number.parseFloat(form.qty);
    const price = Number.parseFloat(form.price);
    const fee = Number.parseFloat(form.fee) || 0;
    if (!form.ticker || !qty || !price) {
      toast.error("Please enter ticker, quantity and price.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/portfolio/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: form.ticker,
          type: form.side.toLowerCase(),
          quantity: qty,
          price,
          fee,
          executedAt: `${form.date}T00:00:00.000Z`,
          note: null,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Unable to save transaction.");
      }
      onRecorded((await res.json()) as PortfolioResponse);
      toast.success(`${form.side} ${qty} ${form.ticker.toUpperCase()} recorded.`);
      setOpen(false);
      setForm({ ...form, qty: "", price: "", fee: "0" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to save transaction.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-border bg-card overflow-hidden"
      aria-labelledby="txlog-heading"
    >
      <div className="p-5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 id="txlog-heading" className="font-semibold">
            Transaction History
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Trades persisted in PostgreSQL with execution price, quantity and fee.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{visibleTxs.length} trades</span>
          <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5" disabled={disabled}>
            <Plus className="w-3.5 h-3.5" />
            Add Transaction
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left font-medium px-5 py-3">Date</th>
              <th className="text-left font-medium px-5 py-3">Asset</th>
              <th className="text-center font-medium px-5 py-3">Side</th>
              <th className="text-right font-medium px-5 py-3">Quantity</th>
              <th className="text-right font-medium px-5 py-3">Price</th>
              <th className="text-right font-medium px-5 py-3">Fee</th>
              <th className="text-right font-medium px-5 py-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {visibleTxs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                  No transactions found.
                </td>
              </tr>
            )}
            {visibleTxs.map((tx) => {
              const total = tx.qty * tx.price + (tx.side === "Buy" ? tx.fee : -tx.fee);
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
                      {isBuy ? "Buy" : "Sell"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{tx.qty.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{fmt2(tx.price)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {tx.fee ? fmt2(tx.fee) : "-"}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums font-semibold">{fmt2(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Transaction</DialogTitle>
            <DialogDescription>Record a new buy or sell trade in PostgreSQL.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 grid grid-cols-2 gap-2">
              {(["Buy", "Sell"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => setForm({ ...form, side })}
                  className={`py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
                    form.side === side
                      ? side === "Buy"
                        ? "bg-bull/15 text-bull border-bull/30"
                        : "bg-bear/15 text-bear border-bear/30"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {side}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-ticker">Ticker</Label>
              <Input
                id="tx-ticker"
                value={form.ticker}
                onChange={(event) => setForm({ ...form, ticker: event.target.value })}
                placeholder="BTC"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-date">Date</Label>
              <Input
                id="tx-date"
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-qty">Quantity</Label>
              <Input
                id="tx-qty"
                type="number"
                step="any"
                value={form.qty}
                onChange={(event) => setForm({ ...form, qty: event.target.value })}
                placeholder="0.25"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-price">Price (USD)</Label>
              <Input
                id="tx-price"
                type="number"
                step="any"
                value={form.price}
                onChange={(event) => setForm({ ...form, price: event.target.value })}
                placeholder="67000"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="tx-fee">Fee (USD)</Label>
              <Input
                id="tx-fee"
                type="number"
                step="any"
                value={form.fee}
                onChange={(event) => setForm({ ...form, fee: event.target.value })}
                placeholder="0"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? "Saving..." : "Save Transaction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
