import { TrendingUp, TrendingDown, Eye, EyeOff, Minus, Plus, Activity, Shield, AlertTriangle, Target, Sigma } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

type Sentiment = "Bullish" | "Bearish" | "Neutral";

type Holding = {
  ticker: string;
  name: string;
  qty: number;
  price: number;
  cost: number;
  alloc: number;
  sentiment: Sentiment;
  category: "Crypto" | "Stocks" | "Cash";
};

const holdings: Holding[] = [
  { ticker: "BTC", name: "Bitcoin", qty: 0.85, price: 67420, cost: 54200, alloc: 28, sentiment: "Bullish", category: "Crypto" },
  { ticker: "ETH", name: "Ethereum", qty: 12.4, price: 3512, cost: 2980, alloc: 12, sentiment: "Bullish", category: "Crypto" },
  { ticker: "SPY", name: "S&P 500 ETF", qty: 45, price: 528.1, cost: 510.2, alloc: 18, sentiment: "Neutral", category: "Stocks" },
  { ticker: "NVDA", name: "NVIDIA Corp.", qty: 28, price: 1142.5, cost: 720.3, alloc: 14, sentiment: "Bullish", category: "Stocks" },
  { ticker: "TSLA", name: "Tesla Inc.", qty: 22, price: 178.4, cost: 220.1, alloc: 8, sentiment: "Bearish", category: "Stocks" },
  { ticker: "USDC", name: "USD Cash", qty: 20000, price: 1, cost: 1, alloc: 20, sentiment: "Neutral", category: "Cash" },
];

const allocationColors: Record<Holding["category"], string> = {
  Crypto: "var(--primary)",
  Stocks: "var(--bull)",
  Cash: "var(--muted-foreground)",
};

const TIMEFRAMES = ["1W", "1M", "YTD", "1Y"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const POINTS: Record<Timeframe, number> = { "1W": 7, "1M": 30, YTD: 20, "1Y": 12 };
const LABELS: Record<Timeframe, (i: number, n: number) => string> = {
  "1W": (i) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i] ?? `${i}`,
  "1M": (i) => `D${i + 1}`,
  YTD: (i) => `W${i + 1}`,
  "1Y": (i) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][i] ?? `${i}`,
};

// Deterministic pseudo-random series (seeded) – avoids SSR hydration mismatch.
function series(n: number, seed: number, drift: number) {
  let s = seed;
  const out: number[] = [];
  let v = 100;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280 - 0.5;
    v += r * 2.4 + drift;
    out.push(+v.toFixed(2));
  }
  return out;
}

export function MockPortfolio() {
  const [hide, setHide] = useState(false);
  const [tf, setTf] = useState<Timeframe>("1M");

  const totalValue = holdings.reduce((s, h) => s + h.qty * h.price, 0);
  const totalCost = holdings.reduce((s, h) => s + h.qty * h.cost, 0);
  const totalPnL = totalValue - totalCost;
  const totalPnLPct = (totalPnL / totalCost) * 100;
  const day = 2.4;

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const allocationData = useMemo(() => {
    const map: Record<string, number> = {};
    holdings.forEach((h) => (map[h.category] = (map[h.category] ?? 0) + h.alloc));
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, []);

  const perfData = useMemo(() => {
    const n = POINTS[tf];
    const p = series(n, 7, 0.35);
    const b = series(n, 13, 0.18);
    return p.map((v, i) => ({ label: LABELS[tf](i, n), Portfolio: v, Benchmark: b[i] }));
  }, [tf]);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Mock Portfolio — Asset Analytics
        </h1>
        <p className="text-sm text-muted-foreground">
          Simulated multi-asset portfolio with live PnL, allocation, performance vs benchmark and AI sentiment.
        </p>
      </header>

      {/* Top Overview */}
      <section className="grid lg:grid-cols-2 gap-6" aria-labelledby="overview-heading">
        <h2 id="overview-heading" className="sr-only">Portfolio overview</h2>
        {/* Left: Balance + Donut */}
        <div className="space-y-6">
          <div className="rounded-3xl p-7 border border-border bg-card shadow-elegant">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              Total Balance
              <button onClick={() => setHide(!hide)} className="hover:text-foreground" aria-label="toggle balance">
                {hide ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="mt-2 text-5xl md:text-6xl font-bold tracking-tight tabular-nums">
              {hide ? "••••••" : fmt(totalValue)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-full ${
                  day >= 0 ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                }`}
              >
                {day >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {day >= 0 ? "+" : ""}{day}% · 24h
              </span>
              <span className="text-xs text-muted-foreground">
                Total PnL:{" "}
                <span className={totalPnL >= 0 ? "text-bull" : "text-bear"}>
                  {totalPnL >= 0 ? "+" : ""}
                  {fmt(totalPnL)} ({totalPnLPct.toFixed(2)}%)
                </span>
              </span>
            </div>
          </div>

          <div className="rounded-3xl p-6 border border-border bg-card">
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
                        <Cell key={d.name} fill={allocationColors[d.name as Holding["category"]]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
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
                      style={{ backgroundColor: allocationColors[d.name as Holding["category"]] }}
                    />
                    <span className="text-muted-foreground w-16">{d.name}</span>
                    <span className="font-semibold tabular-nums">{d.value}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Right: Performance vs Benchmark */}
        <div className="rounded-3xl p-6 border border-border bg-card flex flex-col">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold">Performance vs Benchmark</h2>
              <p className="text-xs text-muted-foreground mt-1">Portfolio compared to S&amp;P 500</p>
            </div>
            <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-1">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t}
                  onClick={() => setTf(t)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    tf === t
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-6 text-xs">
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-primary" /> Portfolio
            </span>
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground" /> S&amp;P 500
            </span>
          </div>

          <div className="flex-1 mt-4 min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={perfData} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
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
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Area type="monotone" dataKey="Portfolio" stroke="var(--primary)" strokeWidth={2.2} fill="url(#gPort)" />
                <Area type="monotone" dataKey="Benchmark" stroke="var(--muted-foreground)" strokeWidth={1.8} strokeDasharray="4 3" fill="url(#gBench)" />
                <Legend wrapperStyle={{ display: "none" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Smart Holdings Table */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Smart Holdings</h2>
            <p className="text-xs text-muted-foreground mt-0.5">AI sentiment integrated from Smart Insights</p>
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
                <th className="text-center font-medium px-5 py-3">AI Sentiment</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const value = h.qty * h.price;
                const pnl = (h.price - h.cost) * h.qty;
                const pnlPct = ((h.price - h.cost) / h.cost) * 100;
                const up = pnl >= 0;
                return (
                  <tr key={h.ticker} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-primary text-primary-foreground grid place-items-center text-xs font-bold">
                          {h.ticker.slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-semibold">{h.name}</div>
                          <div className="text-xs text-muted-foreground">{h.ticker}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-right tabular-nums px-5 py-4">
                      ${h.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="text-right tabular-nums px-5 py-4 font-medium">{fmt(value)}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold tabular-nums w-10">{h.alloc}%</span>
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-gradient-primary" style={{ width: `${h.alloc}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="text-right px-5 py-4">
                      <div className={`font-semibold tabular-nums ${up ? "text-bull" : "text-bear"}`}>
                        {up ? "+" : ""}
                        {fmt(pnl)}
                      </div>
                      <div className={`text-xs tabular-nums ${up ? "text-bull" : "text-bear"}`}>
                        {up ? "+" : ""}
                        {pnlPct.toFixed(2)}%
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-center">
                        <SentimentBadge s={h.sentiment} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function SentimentBadge({ s }: { s: Sentiment }) {
  const map = {
    Bullish: { cls: "bg-bull/15 text-bull", Icon: TrendingUp },
    Bearish: { cls: "bg-bear/15 text-bear", Icon: TrendingDown },
    Neutral: { cls: "bg-muted text-muted-foreground", Icon: Minus },
  } as const;
  const { cls, Icon } = map[s];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${cls}`}>
      <Icon className="w-3.5 h-3.5" />
      {s}
    </span>
  );
}
