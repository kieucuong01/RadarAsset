import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  Play,
  FileText,
  Sparkles,
  Sliders,
  FlaskConical,
  Activity,
  ChevronDown,
  Check,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  BarChart3,
  Zap,
} from "lucide-react";

type TabKey = "optimizer" | "alpha" | "backtest";

const TABS: { key: TabKey; label: string; icon: typeof Sliders }[] = [
  { key: "optimizer", label: "Portfolio Optimizer", icon: Sliders },
  { key: "alpha", label: "Alpha Strategies & AI Predict", icon: Sparkles },
  { key: "backtest", label: "Backtest & Risk Engine", icon: FlaskConical },
];

export function QuantLab() {
  const [tab, setTab] = useState<TabKey>("optimizer");

  return (
    <main className="max-w-[1500px] mx-auto px-4 sm:px-6 py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <Activity className="w-3.5 h-3.5 text-primary" />
            Quantitative Workbench
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-1">Quant Lab</h1>
          <p className="text-sm text-muted-foreground">
            Optimize allocations, research alpha factors, and stress-test strategies on historical data.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-bull/10 text-bull font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-bull animate-pulse" />
            ENGINE LIVE
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted text-muted-foreground font-mono">
            v2.4.1 · 1.2M backtests
          </span>
        </div>
      </div>

      {/* Top Tabs */}
      <div className="border-b border-border mb-6 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
                {active && (
                  <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-gradient-primary rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "optimizer" && <OptimizerTab />}
      {tab === "alpha" && <AlphaTab />}
      {tab === "backtest" && <BacktestTab />}
    </main>
  );
}

/* --------------------------- TAB 1: OPTIMIZER --------------------------- */

const ASSET_CLASSES = [
  "US Equities",
  "EU Equities",
  "Emerging Markets",
  "Crypto",
  "Commodities",
  "Bonds",
  "Real Estate",
  "FX",
];

const PIE_COLORS = [
  "var(--color-primary)",
  "oklch(0.72 0.15 155)",
  "oklch(0.7 0.18 60)",
  "oklch(0.66 0.18 18)",
  "oklch(0.65 0.16 280)",
  "oklch(0.7 0.14 200)",
];

function OptimizerTab() {
  const [riskA, setRiskA] = useState(4);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([
    "US Equities",
    "Crypto",
    "Commodities",
    "Bonds",
  ]);

  // Deterministic "optimal" allocation based on riskA + selection
  const allocation = useMemo(() => {
    const base = selected.length ? selected : ASSET_CLASSES.slice(0, 4);
    // Higher risk aversion → tilt to bonds/commodities; lower → tilt to crypto/equities
    const weights = base.map((name, i) => {
      const defensive = /Bonds|Commodities|Real Estate/.test(name) ? 1 : 0;
      const aggressive = /Crypto|Emerging|Equities/.test(name) ? 1 : 0;
      const score =
        10 +
        defensive * (riskA * 1.6) +
        aggressive * ((11 - riskA) * 1.4) +
        (i % 3) * 1.2;
      return { name, score };
    });
    const sum = weights.reduce((s, w) => s + w.score, 0);
    return weights
      .map((w) => ({ name: w.name, value: +((w.score / sum) * 100).toFixed(1) }))
      .sort((a, b) => b.value - a.value);
  }, [riskA, selected]);

  const expectedReturn = (14 - riskA * 0.9).toFixed(2);
  const expectedVol = (22 - riskA * 1.4).toFixed(2);
  const sharpe = ((+expectedReturn - 4) / +expectedVol).toFixed(2);

  const toggle = (name: string) =>
    setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));

  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-6">
      {/* Settings */}
      <aside className="rounded-2xl border border-border bg-card p-6 space-y-7 lg:sticky lg:top-20 lg:self-start">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Sliders className="w-4 h-4 text-primary" />
            Mean-Variance Settings
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Markowitz optimization · efficient frontier
          </p>
        </div>

        {/* Risk aversion */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <label className="text-sm font-medium">Risk Aversion Coefficient (A)</label>
            <span className="font-mono text-2xl font-bold tabular-nums text-primary">
              {riskA.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={0.1}
            value={riskA}
            onChange={(e) => setRiskA(+e.target.value)}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5 font-mono uppercase tracking-wider">
            <span>Aggressive</span>
            <span>Balanced</span>
            <span>Defensive</span>
          </div>
        </div>

        {/* Asset classes multi-select */}
        <div>
          <label className="text-sm font-medium block mb-2">Asset Classes</label>
          <div className="relative">
            <button
              onClick={() => setOpen(!open)}
              className="w-full flex items-center justify-between bg-muted/60 rounded-lg px-3 py-2.5 text-sm hover:bg-muted transition-colors"
            >
              <span className="truncate text-left">
                {selected.length} selected
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover shadow-elegant p-1 max-h-64 overflow-auto">
                {ASSET_CLASSES.map((a) => {
                  const sel = selected.includes(a);
                  return (
                    <button
                      key={a}
                      onClick={() => toggle(a)}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-sm rounded-md hover:bg-muted text-left"
                    >
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center ${
                          sel ? "bg-primary border-primary" : "border-border"
                        }`}
                      >
                        {sel && <Check className="w-3 h-3 text-primary-foreground" />}
                      </span>
                      {a}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {selected.map((s) => (
              <span
                key={s}
                className="text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded bg-primary/10 text-primary"
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
          {[
            { l: "E[R]", v: `${expectedReturn}%`, t: "bull" },
            { l: "σ", v: `${expectedVol}%`, t: "neutral" },
            { l: "Sharpe", v: sharpe, t: "primary" },
          ].map((m) => (
            <div key={m.l} className="rounded-lg bg-muted/60 p-2.5 text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                {m.l}
              </div>
              <div
                className={`mt-0.5 font-bold tabular-nums ${
                  m.t === "bull" ? "text-bull" : m.t === "primary" ? "text-primary" : ""
                }`}
              >
                {m.v}
              </div>
            </div>
          ))}
        </div>

        <button className="w-full inline-flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-elegant hover:opacity-95">
          <Zap className="w-4 h-4" />
          Solve Optimal Allocation
        </button>
      </aside>

      {/* Output */}
      <section className="space-y-6">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Mathematically Optimal Allocation</h3>
              <p className="text-xs text-muted-foreground">
                Max U = E[R] − ½ · A · σ²  ·  A = {riskA.toFixed(1)}
              </p>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-bull/10 text-bull">
              Converged · 142 iter
            </span>
          </div>

          <div className="grid md:grid-cols-2 gap-6 items-center">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocation}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={110}
                    paddingAngle={2}
                    stroke="var(--color-card)"
                    strokeWidth={2}
                  >
                    {allocation.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => `${v}%`}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div>
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                  <tr className="border-b border-border">
                    <th className="text-left py-2">Asset Class</th>
                    <th className="text-right py-2">Weight</th>
                    <th className="text-right py-2">Allocation</th>
                  </tr>
                </thead>
                <tbody>
                  {allocation.map((row, i) => (
                    <tr key={row.name} className="border-b border-border last:border-0">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-sm"
                            style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          {row.name}
                        </div>
                      </td>
                      <td className="text-right tabular-nums font-semibold py-2.5">
                        {row.value}%
                      </td>
                      <td className="py-2.5 w-32">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full"
                            style={{
                              width: `${row.value}%`,
                              background: PIE_COLORS[i % PIE_COLORS.length],
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* --------------------------- TAB 2: ALPHA + AI --------------------------- */

type Strategy = {
  name: string;
  family: "Crypto" | "Equities" | "FX" | "Multi-Asset";
  timeframe: string;
  indicators: string[];
  edge: string;
  desc: string;
};

const STRATEGIES: Strategy[] = [
  {
    name: "Skewness Lottery Crypto",
    family: "Crypto",
    timeframe: "1D",
    indicators: ["Skewness", "Volume", "RSI"],
    edge: "+24.6% CAGR",
    desc: "Long positively-skewed altcoins, exploiting retail lottery preference.",
  },
  {
    name: "Smart Money Concept (SMC)",
    family: "FX",
    timeframe: "4H",
    indicators: ["SMC", "Order Block", "FVG"],
    edge: "+18.2% CAGR",
    desc: "Institutional liquidity grabs at premium/discount zones with FVG entries.",
  },
  {
    name: "Cross-Sectional Momentum",
    family: "Equities",
    timeframe: "1M",
    indicators: ["Momentum", "Sharpe"],
    edge: "+12.8% CAGR",
    desc: "Long top decile / short bottom decile of 12-1 month returns universe.",
  },
  {
    name: "Volatility Risk Premium",
    family: "Multi-Asset",
    timeframe: "1W",
    indicators: ["IV/RV", "VIX"],
    edge: "+9.4% CAGR",
    desc: "Systematically short implied vol when IV-RV spread exceeds threshold.",
  },
  {
    name: "Mean-Reversion Z-Score",
    family: "Equities",
    timeframe: "1H",
    indicators: ["Z-Score", "Bollinger", "RSI"],
    edge: "+15.1% CAGR",
    desc: "Pairs trade cointegrated equities reverting to spread mean.",
  },
  {
    name: "Funding Rate Carry",
    family: "Crypto",
    timeframe: "8H",
    indicators: ["Funding", "Basis"],
    edge: "+11.7% CAGR",
    desc: "Delta-neutral carry harvesting positive perpetual funding rates.",
  },
];

function genPredictionData() {
  const data: { t: string; price: number | null; predicted: number | null }[] = [];
  let p = 67000;
  // 30 historical points
  for (let i = 0; i < 30; i++) {
    p += (Math.sin(i / 3) * 600) + (Math.random() - 0.45) * 800;
    data.push({
      t: `D-${30 - i}`,
      price: +p.toFixed(0),
      predicted: null,
    });
  }
  // bridge point
  data[data.length - 1].predicted = data[data.length - 1].price;
  // 14 forecast points
  let f = p;
  for (let i = 1; i <= 14; i++) {
    f += 320 + Math.sin(i / 2) * 180 + (Math.random() - 0.4) * 250;
    data.push({
      t: `D+${i}`,
      price: null,
      predicted: +f.toFixed(0),
    });
  }
  return data;
}

function AlphaTab() {
  const predData = useMemo(genPredictionData, []);

  return (
    <div className="space-y-6">
      {/* Strategy Library */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="font-semibold">Strategy Library</h2>
            <p className="text-xs text-muted-foreground">
              Peer-reviewed quant factors — click to view rules &amp; whitepapers.
            </p>
          </div>
          <span className="text-xs text-muted-foreground font-mono">
            {STRATEGIES.length} strategies
          </span>
        </div>

        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {STRATEGIES.map((s) => (
            <article
              key={s.name}
              className="group rounded-2xl border border-border bg-card p-5 hover:border-primary/50 hover:shadow-elegant transition-all"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    {s.family}
                  </div>
                  <h3 className="font-semibold leading-tight mt-0.5 group-hover:text-primary transition-colors">
                    {s.name}
                  </h3>
                </div>
                <span className="text-[11px] font-mono font-bold text-bull bg-bull/10 px-2 py-1 rounded">
                  {s.edge}
                </span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-4">{s.desc}</p>

              <div className="flex flex-wrap gap-1.5 mb-4">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary">
                  ⏱ {s.timeframe}
                </span>
                {s.indicators.map((ind) => (
                  <span
                    key={ind}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground"
                  >
                    {ind}
                  </span>
                ))}
              </div>

              <button className="w-full inline-flex items-center justify-center gap-2 text-sm font-medium border border-border rounded-lg py-2 hover:bg-muted transition-colors">
                <FileText className="w-3.5 h-3.5" />
                Read Paper / Rules
              </button>
            </article>
          ))}
        </div>
      </section>

      {/* AI Price Prediction */}
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              AI Price Prediction
            </h2>
            <p className="text-xs text-muted-foreground">
              BTC/USD · LSTM ensemble · 14-day horizon · 87.4% directional accuracy
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-foreground" />
              Historical
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 border-t-2 border-dashed border-primary" />
              AI Projection
            </span>
          </div>
        </div>

        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={predData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="t" stroke="var(--color-muted-foreground)" fontSize={11} interval={4} />
              <YAxis
                stroke="var(--color-muted-foreground)"
                fontSize={11}
                domain={["dataMin - 1000", "dataMax + 1000"]}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
                formatter={(v: number) => `$${v.toLocaleString("en-US")}`}
              />
              <Line
                type="monotone"
                dataKey="price"
                name="Historical"
                stroke="var(--color-foreground)"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="predicted"
                name="AI Projection"
                stroke="var(--color-primary)"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                dot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-border">
          {[
            { l: "Target (14d)", v: "$72,840", t: "bull", icon: Target },
            { l: "Confidence", v: "87.4%", t: "primary", icon: Sparkles },
            { l: "Upside", v: "+8.2%", t: "bull", icon: TrendingUp },
            { l: "Downside Risk", v: "-3.6%", t: "bear", icon: TrendingDown },
          ].map((k) => {
            const Icon = k.icon;
            return (
              <div key={k.l} className="rounded-lg bg-muted/60 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-1.5">
                  <Icon className="w-3 h-3" />
                  {k.l}
                </div>
                <div
                  className={`mt-1 text-lg font-bold tabular-nums ${
                    k.t === "bull"
                      ? "text-bull"
                      : k.t === "bear"
                        ? "text-bear"
                        : "text-primary"
                  }`}
                >
                  {k.v}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* --------------------------- TAB 3: BACKTEST --------------------------- */

function BacktestTab() {
  const [strategy, setStrategy] = useState(STRATEGIES[0].name);
  const [from, setFrom] = useState("2023-01-01");
  const [to, setTo] = useState("2025-12-31");
  const [riskMode, setRiskMode] = useState<"fixed" | "kelly">("fixed");
  const [fixedRisk, setFixedRisk] = useState(2);

  return (
    <div className="grid lg:grid-cols-[400px_1fr] gap-6">
      {/* Left: Inputs */}
      <aside className="rounded-2xl border border-border bg-card p-6 space-y-6 lg:sticky lg:top-20 lg:self-start">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-primary" />
            Backtest Configuration
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Vectorized engine · slippage &amp; fees included
          </p>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1.5">Select Strategy</label>
          <div className="relative">
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full appearance-none bg-muted/60 rounded-lg px-3 py-2.5 text-sm outline-none pr-9 focus:ring-2 focus:ring-primary/50"
            >
              {STRATEGIES.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} · {s.family}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1.5">Date Range</label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                From
              </span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full mt-1 bg-muted/60 rounded-lg px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                To
              </span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full mt-1 bg-muted/60 rounded-lg px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>
        </div>

        {/* Risk Management */}
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-primary" />
            <h4 className="font-semibold text-sm">Risk Management</h4>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="risk"
              checked={riskMode === "fixed"}
              onChange={() => setRiskMode("fixed")}
              className="mt-1 accent-primary"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Fixed Risk %</div>
              <div className="text-xs text-muted-foreground">
                Risk a constant % of equity per trade.
              </div>
              {riskMode === "fixed" && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={0.1}
                    max={20}
                    step={0.1}
                    value={fixedRisk}
                    onChange={(e) => setFixedRisk(+e.target.value)}
                    className="w-24 bg-background border border-border rounded-md px-2.5 py-1.5 text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <span className="text-sm text-muted-foreground">% per trade</span>
                </div>
              )}
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="risk"
              checked={riskMode === "kelly"}
              onChange={() => setRiskMode("kelly")}
              className="mt-1 accent-primary"
            />
            <div className="flex-1">
              <div className="text-sm font-medium flex items-center gap-2">
                Kelly Criterion
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                  DYNAMIC
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                f* = (bp − q) / b — sized from edge &amp; payoff.
              </div>
              {riskMode === "kelly" && (
                <div className="mt-2 text-[11px] font-mono text-muted-foreground">
                  Suggested fractional Kelly: <span className="text-primary">0.25 ×</span>
                </div>
              )}
            </div>
          </label>
        </div>

        <button className="w-full inline-flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-bold text-base py-4 rounded-xl shadow-elegant hover:opacity-95 transition-opacity">
          <Play className="w-5 h-5 fill-current" />
          RUN BACKTEST
        </button>
      </aside>

      {/* Right: Output */}
      <section className="space-y-6">
        {/* TradingView placeholder */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Trade Visualization</h3>
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {strategy}
              </span>
            </div>
            <div className="flex gap-1">
              {["1H", "4H", "1D", "1W"].map((tf) => (
                <button
                  key={tf}
                  className="text-[11px] font-mono px-2 py-1 rounded hover:bg-muted text-muted-foreground"
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
          <div className="relative h-[420px] bg-[radial-gradient(circle_at_50%_50%,oklch(from_var(--color-primary)_l_c_h/0.08),transparent_70%)]">
            {/* Faux grid */}
            <div
              className="absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  "linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
                backgroundSize: "48px 48px",
              }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
              <div className="w-14 h-14 rounded-2xl bg-gradient-primary text-primary-foreground grid place-items-center shadow-elegant mb-4">
                <BarChart3 className="w-7 h-7" />
              </div>
              <h4 className="font-semibold">TradingView Advanced Chart Widget</h4>
              <p className="text-sm text-muted-foreground max-w-md mt-1">
                Embed entry / exit markers, indicator overlays, and trade replays once the backtest engine completes.
              </p>
              <div className="flex gap-2 mt-4">
                <span className="text-[10px] font-mono uppercase px-2 py-1 rounded bg-bull/10 text-bull">
                  ▲ 142 LONG
                </span>
                <span className="text-[10px] font-mono uppercase px-2 py-1 rounded bg-bear/10 text-bear">
                  ▼ 118 SHORT
                </span>
                <span className="text-[10px] font-mono uppercase px-2 py-1 rounded bg-muted text-muted-foreground">
                  ⊘ 23 SKIPPED
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Max Drawdown",
              value: "-12.6%",
              sub: "↓ 47 days recovery",
              tone: "bear",
              icon: TrendingDown,
            },
            {
              label: "Profit Factor",
              value: "2.41",
              sub: "Gross W / Gross L",
              tone: "bull",
              icon: Target,
            },
            {
              label: "Sharpe Ratio",
              value: "1.84",
              sub: "Rf = 4.0%",
              tone: "primary",
              icon: Activity,
            },
            {
              label: "Win Rate",
              value: "62.3%",
              sub: "186 / 298 trades",
              tone: "bull",
              icon: TrendingUp,
            },
          ].map((k) => {
            const Icon = k.icon;
            return (
              <div
                key={k.label}
                className="rounded-2xl border border-border bg-card p-5 relative overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                    {k.label}
                  </div>
                  <Icon
                    className={`w-4 h-4 ${
                      k.tone === "bull"
                        ? "text-bull"
                        : k.tone === "bear"
                          ? "text-bear"
                          : "text-primary"
                    }`}
                  />
                </div>
                <div
                  className={`mt-2 text-3xl font-bold tabular-nums ${
                    k.tone === "bull"
                      ? "text-bull"
                      : k.tone === "bear"
                        ? "text-bear"
                        : "text-foreground"
                  }`}
                >
                  {k.value}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 font-mono">{k.sub}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
