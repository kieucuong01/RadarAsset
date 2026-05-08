import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { Play, Plus, X, Search } from "lucide-react";

type Asset = { ticker: string; name: string; weight: number };

const initialAssets: Asset[] = [
  { ticker: "BTC", name: "Bitcoin", weight: 35 },
  { ticker: "SPY", name: "S&P 500 ETF", weight: 30 },
  { ticker: "VN30", name: "VN30 Index", weight: 20 },
  { ticker: "GOLD", name: "Gold", weight: 15 },
];

// Generate dummy equity curve (~36 months)
function genCurve() {
  const data: { m: string; portfolio: number; benchmark: number }[] = [];
  let p = 100, b = 100;
  const start = new Date(2023, 0, 1);
  for (let i = 0; i < 36; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const pr = (Math.sin(i / 3) * 0.04) + (Math.random() - 0.4) * 0.05 + 0.018;
    const br = (Math.sin(i / 4) * 0.025) + (Math.random() - 0.45) * 0.03 + 0.009;
    p *= 1 + pr;
    b *= 1 + br;
    data.push({
      m: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      portfolio: +p.toFixed(2),
      benchmark: +b.toFixed(2),
    });
  }
  return data;
}

// Monthly returns heatmap data
const years = [2023, 2024, 2025];
const monthLabels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function genMonthly() {
  return years.map((y) => ({
    year: y,
    months: monthLabels.map(() => +(Math.random() * 14 - 5).toFixed(1)),
  }));
}

function returnColor(v: number) {
  const intensity = Math.min(Math.abs(v) / 10, 1);
  if (v >= 0) return `oklch(0.72 ${0.06 + intensity * 0.12} 155 / ${0.15 + intensity * 0.85})`;
  return `oklch(0.66 ${0.08 + intensity * 0.14} 18 / ${0.15 + intensity * 0.85})`;
}

export function QuantLab() {
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [search, setSearch] = useState("");
  const data = useMemo(genCurve, []);
  const monthly = useMemo(genMonthly, []);

  const total = assets.reduce((s, a) => s + a.weight, 0);

  const updateWeight = (i: number, w: number) => {
    setAssets((arr) => arr.map((a, idx) => (idx === i ? { ...a, weight: w } : a)));
  };
  const removeAsset = (i: number) =>
    setAssets((arr) => arr.filter((_, idx) => idx !== i));
  const addAsset = () => {
    if (!search.trim()) return;
    setAssets((arr) => [
      ...arr,
      { ticker: search.toUpperCase().slice(0, 6), name: search, weight: 10 },
    ]);
    setSearch("");
  };

  const metrics = [
    { label: "CAGR", value: "+18.4%", tone: "bull" as const },
    { label: "Max Drawdown", value: "-12.6%", tone: "bear" as const },
    { label: "Win Rate", value: "62%", tone: "neutral" as const },
    { label: "Sharpe Ratio", value: "1.84", tone: "neutral" as const },
  ];

  return (
    <main className="max-w-[1500px] mx-auto px-4 sm:px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Quant Lab</h1>
        <p className="text-sm text-muted-foreground">Design and backtest multi-asset strategies with institutional-grade analytics.</p>
      </div>

      <div className="grid lg:grid-cols-[360px_1fr] gap-6">
        {/* Left panel — Strategy config */}
        <aside className="rounded-2xl border border-border bg-card p-5 space-y-6 lg:sticky lg:top-20 lg:self-start">
          <div>
            <h3 className="font-semibold mb-3">Asset Allocation</h3>
            <div className="flex items-center gap-2 mb-4 bg-muted/60 rounded-lg px-3 py-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addAsset()}
                placeholder="Add asset (e.g. ETH)"
                className="bg-transparent outline-none text-sm flex-1 placeholder:text-muted-foreground"
              />
              <button onClick={addAsset} className="text-primary hover:opacity-80">
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {assets.map((a, i) => (
                <div key={a.ticker + i} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{a.ticker}</span>
                      <span className="text-muted-foreground text-xs">{a.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums">{a.weight}%</span>
                      <button onClick={() => removeAsset(i)} className="text-muted-foreground hover:text-bear">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={a.weight}
                    onChange={(e) => updateWeight(i, +e.target.value)}
                    className="w-full accent-primary"
                  />
                </div>
              ))}
            </div>

            <div className={`mt-5 flex items-center justify-between p-3 rounded-lg border ${
              total === 100 ? "border-bull/30 bg-bull/10 text-bull" : "border-bear/30 bg-bear/10 text-bear"
            }`}>
              <span className="text-xs font-semibold tracking-wide">TOTAL</span>
              <span className="font-bold tabular-nums">{total}%</span>
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-3">Backtest Period</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">From</label>
                <input
                  type="date"
                  defaultValue="2023-01-01"
                  className="w-full mt-1 bg-muted/60 rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">To</label>
                <input
                  type="date"
                  defaultValue="2025-12-31"
                  className="w-full mt-1 bg-muted/60 rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
            </div>
          </div>

          <button className="w-full inline-flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-elegant hover:opacity-95 transition-opacity">
            <Play className="w-4 h-4 fill-current" />
            Run Backtest
          </button>
        </aside>

        {/* Right panel — Results */}
        <section className="space-y-6">
          {/* Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {metrics.map((m) => (
              <div key={m.label} className="rounded-2xl border border-border bg-card p-5">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{m.label}</div>
                <div
                  className={`mt-2 text-2xl md:text-3xl font-bold tabular-nums ${
                    m.tone === "bull" ? "text-bull" : m.tone === "bear" ? "text-bear" : "text-foreground"
                  }`}
                >
                  {m.value}
                </div>
              </div>
            ))}
          </div>

          {/* Equity Curve */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold">Equity Curve</h3>
                <p className="text-xs text-muted-foreground">Portfolio vs S&amp;P 500 benchmark — base 100</p>
              </div>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="bGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-muted-foreground)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--color-muted-foreground)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="m" stroke="var(--color-muted-foreground)" fontSize={11} interval={3} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="benchmark"
                    name="Benchmark"
                    stroke="var(--color-muted-foreground)"
                    strokeWidth={2}
                    fill="url(#bGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="portfolio"
                    name="Portfolio"
                    stroke="var(--color-primary)"
                    strokeWidth={2.5}
                    fill="url(#pGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Monthly returns heatmap */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-semibold mb-4">Monthly Returns</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-muted-foreground font-medium py-2 pr-3">Year</th>
                    {monthLabels.map((m) => (
                      <th key={m} className="text-center text-muted-foreground font-medium py-2">{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((row) => (
                    <tr key={row.year}>
                      <td className="font-semibold py-1 pr-3">{row.year}</td>
                      {row.months.map((v, i) => (
                        <td key={i} className="p-0.5">
                          <div
                            className="rounded-md py-2 text-center font-semibold tabular-nums"
                            style={{ backgroundColor: returnColor(v), color: "var(--color-foreground)" }}
                          >
                            {v > 0 ? "+" : ""}{v}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
