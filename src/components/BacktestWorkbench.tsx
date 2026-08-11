"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, AlertTriangle, CheckCircle2, Play, TrendingDown } from "lucide-react";
import { toast } from "sonner";

import { MarketDataHealthPanel } from "@/components/MarketDataHealthPanel";
import { Progress } from "@/components/ui/progress";
import { createRollingBacktestRange, type BacktestSubmission } from "@/lib/backtest/contracts";
import {
  getBacktestRun,
  isActiveRun,
  submitBacktest,
  type BacktestRun,
} from "@/lib/backtest/client";

const ASSETS = [
  { symbol: "FPT" as const, name: "FPT · HOSE", market: "Vietnam equity", maximum: 2 },
  { symbol: "BTC" as const, name: "BTC/USDT · Binance", market: "Crypto spot", maximum: 1 },
  { symbol: "XAU" as const, name: "XAU/USD · OTC", market: "Gold spot", maximum: 1 },
];

function numericMetric(run: BacktestRun | null, key: string) {
  const value = run?.metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function BacktestWorkbench() {
  const [timeframe, setTimeframe] = useState<"1d" | "1h">("1d");
  const [from, setFrom] = useState(() => createRollingBacktestRange().from);
  const [to, setTo] = useState(() => createRollingBacktestRange().to);
  const [fastPeriod, setFastPeriod] = useState(5);
  const [slowPeriod, setSlowPeriod] = useState(20);
  const [initialCapital, setInitialCapital] = useState(100_000);
  const [feeBps, setFeeBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);
  const [fptLeverage, setFptLeverage] = useState(1);
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!run || !isActiveRun(run.status)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void getBacktestRun(run.id, fetch, controller.signal)
        .then(setRun)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          toast.error("Không thể cập nhật trạng thái backtest.");
        });
    }, 2_000);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [run]);

  const equity = useMemo(
    () => run?.artifacts.find((artifact) => artifact.kind === "equity")?.payload ?? [],
    [run],
  );
  const drawdown = useMemo(
    () => run?.artifacts.find((artifact) => artifact.kind === "drawdown")?.payload ?? [],
    [run],
  );
  const trades = useMemo(
    () => run?.artifacts.find((artifact) => artifact.kind === "trades")?.payload ?? [],
    [run],
  );
  const manifest = useMemo(
    () => run?.artifacts.find((artifact) => artifact.kind === "manifest")?.payload ?? null,
    [run],
  );

  async function startBacktest() {
    const submission: BacktestSubmission = {
      strategyCode: "ma_crossover",
      strategyVersion: "1.0.0",
      strategyParameters: { fastPeriod, slowPeriod },
      timeframe,
      initialCapital,
      feeBps,
      slippageBps,
      from,
      to,
      legs: [
        { symbol: "FPT", leverage: fptLeverage },
        { symbol: "BTC", leverage: 1 },
        { symbol: "XAU", leverage: 1 },
      ],
    };
    setSubmitting(true);
    try {
      const queued = await submitBacktest(submission);
      setRun(queued);
      toast.success("Backtest đã được đưa vào worker queue.");
    } catch {
      toast.error("Không thể tạo backtest. Hãy kiểm tra dataset và tham số.");
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || Boolean(run && isActiveRun(run.status));
  const succeeded = run?.status === "succeeded";

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-5 rounded-2xl border border-border bg-card p-5 xl:sticky xl:top-20 xl:self-start">
        <div>
          <h2 className="font-semibold">MA Crossover v1</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Long-only · signal at close · fill at next bar open
          </p>
        </div>

        <MarketDataHealthPanel timeframe={timeframe} />

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs text-muted-foreground">
            Timeframe
            <select
              value={timeframe}
              onChange={(event) => setTimeframe(event.target.value as "1d" | "1h")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="1d">1 Day</option>
              <option value="1h">1 Hour</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Initial capital
            <input
              type="number"
              min={1_000}
              value={initialCapital}
              onChange={(event) => setInitialCapital(Number(event.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            From
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            To
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Fast SMA
            <input
              type="number"
              min={2}
              max={200}
              value={fastPeriod}
              onChange={(event) => setFastPeriod(Number(event.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Slow SMA
            <input
              type="number"
              min={3}
              max={400}
              value={slowPeriod}
              onChange={(event) => setSlowPeriod(Number(event.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Fee (bps)
            <input
              type="number"
              min={0}
              max={100}
              value={feeBps}
              onChange={(event) => setFeeBps(Number(event.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Slippage (bps)
            <input
              type="number"
              min={0}
              max={200}
              value={slippageBps}
              onChange={(event) => setSlippageBps(Number(event.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
        </div>

        <div className="space-y-2">
          {ASSETS.map((asset) => (
            <div
              key={asset.symbol}
              className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-3"
            >
              <div>
                <div className="text-sm font-semibold">{asset.name}</div>
                <div className="text-[11px] text-muted-foreground">{asset.market} · long only</div>
              </div>
              {asset.symbol === "FPT" ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Leverage
                  <select
                    value={fptLeverage}
                    onChange={(event) => setFptLeverage(Number(event.target.value))}
                    className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
                  >
                    <option value={1}>1x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={2}>2x</option>
                  </select>
                </label>
              ) : (
                <span className="font-mono text-xs text-primary">1x max</span>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={busy || fastPeriod >= slowPeriod}
          onClick={() => void startBacktest()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3 font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-4 w-4 fill-current" />
          {busy ? "BACKTEST ĐANG CHẠY" : "RUN REAL BACKTEST"}
        </button>

        {run && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono uppercase text-muted-foreground">{run.status}</span>
              <span className="font-mono">{run.progress}%</span>
            </div>
            <Progress value={run.progress} />
            <div className="break-all font-mono text-[10px] text-muted-foreground">
              Run {run.id}
            </div>
          </div>
        )}
      </aside>

      <section className="min-w-0 space-y-6">
        {!run && (
          <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <Activity className="mb-4 h-10 w-10 text-primary" />
            <h2 className="text-xl font-semibold">Ready for a reproducible run</h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Kết quả sẽ được worker tính từ đúng dataset version, strategy hash và engine version —
              không dùng KPI hoặc trade giả.
            </p>
          </div>
        )}

        {run?.status === "failed" && (
          <div className="rounded-2xl border border-bear/30 bg-bear/5 p-5">
            <div className="flex items-center gap-2 font-semibold text-bear">
              <AlertTriangle className="h-5 w-5" /> Backtest failed
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {run.errorMessage ?? "Worker không thể hoàn tất run này."}
            </p>
          </div>
        )}

        {succeeded && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-bull/30 bg-bull/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-bull">
                <CheckCircle2 className="h-5 w-5" /> Worker result verified
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">
                {run.engineVersion} · {run.datasetVersionIds.length} datasets · {run.timeframe}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ["Final equity", money(numericMetric(run, "finalEquity"))],
                ["Total return", `${numericMetric(run, "totalReturnPct").toFixed(2)}%`],
                ["Max drawdown", `${numericMetric(run, "maxDrawdownPct").toFixed(2)}%`],
                ["Trades", String(numericMetric(run, "tradeCount"))],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-border bg-card p-4">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h3 className="font-semibold">Equity & drawdown</h3>
                <TrendingDown className="h-4 w-4 text-bear" />
              </div>
              <div className="h-[340px] min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equity} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis dataKey="timestamp" hide />
                    <YAxis tickFormatter={(value) => `$${Math.round(value / 1000)}k`} width={55} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="equity"
                      stroke="var(--color-primary)"
                      strokeWidth={2.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 h-[120px] min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={drawdown}>
                    <XAxis dataKey="timestamp" hide />
                    <YAxis tickFormatter={(value) => `${value}%`} width={55} />
                    <Line
                      type="monotone"
                      dataKey="drawdownPct"
                      stroke="var(--color-bear)"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="border-b border-border p-4">
                <h3 className="font-semibold">Long-only trade ledger</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Fills include configured fee and adverse slippage.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-sm">
                  <thead className="bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      {[
                        "Asset",
                        "Side",
                        "Entry",
                        "Exit",
                        "Quantity",
                        "Fees",
                        "Slippage",
                        "PnL",
                        "Return",
                      ].map((heading) => (
                        <th key={heading} className="px-4 py-3">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((trade, index) => (
                      <tr
                        key={`${trade.asset}-${trade.entryAt}-${index}`}
                        className="border-t border-border/60"
                      >
                        <td className="px-4 py-3 font-semibold">{trade.asset}</td>
                        <td className="px-4 py-3 text-bull">LONG</td>
                        <td className="px-4 py-3 tabular-nums">
                          {trade.entryPrice.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {trade.exitPrice.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{trade.quantity.toFixed(4)}</td>
                        <td className="px-4 py-3 tabular-nums">{trade.fees.toFixed(2)}</td>
                        <td className="px-4 py-3 tabular-nums">{trade.slippageCost.toFixed(2)}</td>
                        <td
                          className={`px-4 py-3 font-semibold tabular-nums ${trade.realizedPnl >= 0 ? "text-bull" : "text-bear"}`}
                        >
                          {trade.realizedPnl.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{trade.returnPct.toFixed(2)}%</td>
                      </tr>
                    ))}
                    {trades.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                          No completed trades in the selected range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {manifest && (
              <div className="rounded-xl border border-border bg-muted/20 p-4 font-mono text-[10px] text-muted-foreground">
                Strategy {run.strategyHash?.slice(0, 12)}… · Engine{" "}
                {String(manifest.engineVersion ?? run.engineVersion)} · research-only datasets
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
