"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ScatterChart,
  Scatter,
  ReferenceDot,
  Label,
} from "recharts";
import {
  Play,
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
  Brain,
  Plus,
  Trash2,
  Coins,
  LineChart as LineChartIcon,
} from "lucide-react";
import { toast } from "sonner";
import { DataStatusBadge } from "@/components/DataStatusBadge";

type TabKey = "optimizer" | "predict" | "backtest";

const TABS: { key: TabKey; label: string; icon: typeof Sliders }[] = [
  { key: "optimizer", label: "Portfolio Optimizer", icon: Sliders },
  { key: "predict", label: "AI Prediction", icon: Brain },
  { key: "backtest", label: "Backtest & Risk Engine", icon: FlaskConical },
];

async function queueQuantRun(strategyName: string, parameters: Record<string, unknown>) {
  try {
    const res = await fetch("/api/quant/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ strategyName, parameters }),
    });
    if (!res.ok) throw new Error("Quant API unavailable");
    const run = (await res.json()) as { id: string; status: string };
    toast.success(`Đã lưu yêu cầu mô phỏng ${strategyName} (${run.status}).`);
  } catch {
    toast.warning("Kết quả vẫn là mô phỏng cục bộ; không lưu được bản ghi Quant Run.");
  }
}

export function QuantLab() {
  const [tab, setTab] = useState<TabKey>("optimizer");

  return (
    <main className="mx-auto min-w-0 max-w-[1500px] px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <Activity className="w-3.5 h-3.5 text-primary" />
            Quantitative Simulation Workbench
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-1">Quant Lab</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Các biểu đồ và chỉ số bên dưới được tạo từ mô hình cục bộ với dữ liệu tổng hợp. Đây là
            công cụ minh họa, không phải tín hiệu giao dịch trực tiếp hay kết quả đã kiểm chứng.
          </p>
        </div>
        <DataStatusBadge
          status="SIMULATED"
          detail="Kết quả được tính trong trình duyệt; API chỉ lưu yêu cầu chạy khi khả dụng."
        />
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
      {tab === "predict" && <PredictTab />}
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
  "oklch(0.68 0.13 100)",
  "oklch(0.6 0.16 320)",
];

// Deterministic pseudo-random correlation between two asset class names
function corrBetween(a: string, b: string): number {
  if (a === b) return 1;
  // Hand-tuned realistic-ish correlations
  const pairs: Record<string, number> = {
    "US Equities|EU Equities": 0.82,
    "US Equities|Emerging Markets": 0.71,
    "US Equities|Crypto": 0.42,
    "US Equities|Commodities": 0.21,
    "US Equities|Bonds": -0.18,
    "US Equities|Real Estate": 0.63,
    "US Equities|FX": -0.12,
    "EU Equities|Emerging Markets": 0.74,
    "EU Equities|Crypto": 0.38,
    "EU Equities|Commodities": 0.26,
    "EU Equities|Bonds": -0.14,
    "EU Equities|Real Estate": 0.58,
    "EU Equities|FX": -0.22,
    "Emerging Markets|Crypto": 0.54,
    "Emerging Markets|Commodities": 0.46,
    "Emerging Markets|Bonds": -0.08,
    "Emerging Markets|Real Estate": 0.49,
    "Emerging Markets|FX": -0.31,
    "Crypto|Commodities": 0.19,
    "Crypto|Bonds": -0.05,
    "Crypto|Real Estate": 0.22,
    "Crypto|FX": -0.09,
    "Commodities|Bonds": -0.21,
    "Commodities|Real Estate": 0.34,
    "Commodities|FX": -0.41,
    "Bonds|Real Estate": 0.12,
    "Bonds|FX": 0.28,
    "Real Estate|FX": -0.16,
  };
  return pairs[`${a}|${b}`] ?? pairs[`${b}|${a}`] ?? 0;
}

function corrColor(v: number): string {
  // -1 → bear, 0 → muted, +1 → bull
  const intensity = Math.min(Math.abs(v), 1);
  if (v >= 0) {
    return `oklch(from var(--color-bull) l c h / ${0.08 + intensity * 0.55})`;
  }
  return `oklch(from var(--color-bear) l c h / ${0.08 + intensity * 0.55})`;
}

function OptimizerTab() {
  const [riskA, setRiskA] = useState(4);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([
    "US Equities",
    "Crypto",
    "Commodities",
    "Bonds",
  ]);

  const allocation = useMemo(() => {
    const base = selected.length ? selected : ASSET_CLASSES.slice(0, 4);
    const weights = base.map((name, i) => {
      const defensive = /Bonds|Commodities|Real Estate/.test(name) ? 1 : 0;
      const aggressive = /Crypto|Emerging|Equities/.test(name) ? 1 : 0;
      const score =
        10 + defensive * (riskA * 1.6) + aggressive * ((11 - riskA) * 1.4) + (i % 3) * 1.2;
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

  const corrAssets = selected.length >= 2 ? selected : ASSET_CLASSES.slice(0, 4);

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
      {/* Settings */}
      <aside className="min-w-0 space-y-7 rounded-2xl border border-border bg-card p-6 lg:sticky lg:top-20 lg:self-start">
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
              <span className="truncate text-left">{selected.length} selected</span>
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

        <button
          onClick={() =>
            void queueQuantRun("Mean-Variance Optimizer", {
              riskAversion: riskA,
              selectedAssets: selected,
            })
          }
          className="w-full inline-flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-elegant hover:opacity-95"
        >
          <Zap className="w-4 h-4" />
          Solve Optimal Allocation
        </button>
      </aside>

      {/* Output */}
      <section className="min-w-0 space-y-6">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Mathematically Optimal Allocation</h3>
              <p className="text-xs text-muted-foreground">
                Max U = E[R] − ½ · A · σ² · A = {riskA.toFixed(1)}
              </p>
            </div>
            <DataStatusBadge status="SIMULATED" detail="Phân bổ được tính từ đầu vào hiện tại." />
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
                      <td className="text-right tabular-nums font-semibold py-2.5">{row.value}%</td>
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

        {/* Synthetic Correlation Matrix */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Synthetic Correlation Matrix
              </h3>
              <p className="text-xs text-muted-foreground">
                Pearson ρ · generated scenario · diversification heatmap
              </p>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ background: corrColor(-0.8) }} />
                −1.0
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-muted" />0
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ background: corrColor(0.8) }} />
                +1.0
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="text-xs border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="p-2" />
                  {corrAssets.map((a) => (
                    <th
                      key={a}
                      className="p-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-center min-w-[72px]"
                    >
                      {a
                        .split(" ")
                        .map((w) => w.slice(0, 3))
                        .join(".")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corrAssets.map((row) => (
                  <tr key={row}>
                    <th className="p-2 text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                      {row}
                    </th>
                    {corrAssets.map((col) => {
                      const v = corrBetween(row, col);
                      const isDiag = row === col;
                      return (
                        <td
                          key={col}
                          className="text-center rounded-md font-mono tabular-nums font-semibold p-0"
                          style={{
                            background: isDiag ? "var(--color-muted)" : corrColor(v),
                            color:
                              Math.abs(v) > 0.5
                                ? "var(--color-foreground)"
                                : "var(--color-muted-foreground)",
                          }}
                        >
                          <div className="px-2 py-3">{v.toFixed(2)}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground mt-3">
            Lower / negative ρ between holdings increases diversification benefit and reduces
            portfolio variance.
          </p>
        </div>

        {/* Risk / Return scatter — Efficient Frontier */}
        <RiskReturnChart
          allocation={allocation}
          portfolioReturn={+expectedReturn}
          portfolioVol={+expectedVol}
        />
      </section>
    </div>
  );
}

/* ---- Risk/Return scatter (Expected Return vs Volatility) ---- */
const ASSET_RR: Record<string, { ret: number; vol: number }> = {
  "US Equities": { ret: 10.5, vol: 16 },
  "EU Equities": { ret: 8.2, vol: 17 },
  "Emerging Markets": { ret: 11.4, vol: 22 },
  Crypto: { ret: 28, vol: 65 },
  Commodities: { ret: 6.5, vol: 19 },
  Bonds: { ret: 4.2, vol: 6 },
  "Real Estate": { ret: 7.8, vol: 14 },
  FX: { ret: 3.1, vol: 9 },
};

function RiskReturnChart({
  allocation,
  portfolioReturn,
  portfolioVol,
}: {
  allocation: { name: string; value: number }[];
  portfolioReturn: number;
  portfolioVol: number;
}) {
  const points = allocation.map((a, i) => {
    const rr = ASSET_RR[a.name] ?? { ret: 6, vol: 12 };
    return {
      name: a.name,
      weight: a.value,
      x: rr.vol,
      y: rr.ret,
      color: PIE_COLORS[i % PIE_COLORS.length],
    };
  });

  // Efficient frontier curve (illustrative parabola)
  const frontier = Array.from({ length: 40 }, (_, i) => {
    const x = 4 + i * 1.8;
    const y = 3 + Math.sqrt(Math.max(x - 4, 0)) * 3.6;
    return { x, y };
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            Risk / Return — Expected Return vs Volatility
          </h3>
          <p className="text-xs text-muted-foreground">
            Asset bubbles sized by portfolio weight · efficient frontier (dashed) · ★ = current
            portfolio
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-primary" /> Portfolio
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-muted-foreground" /> Frontier
          </span>
        </div>
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" opacity={0.5} />
            <XAxis
              type="number"
              dataKey="x"
              name="Volatility"
              domain={[0, 70]}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              stroke="var(--color-border)"
            >
              <Label
                value="Volatility σ (%)"
                position="bottom"
                offset={10}
                style={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
              />
            </XAxis>
            <YAxis
              type="number"
              dataKey="y"
              name="Return"
              domain={[0, 32]}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              stroke="var(--color-border)"
            >
              <Label
                value="Expected Return E[R] (%)"
                angle={-90}
                position="insideLeft"
                style={{
                  fill: "var(--color-muted-foreground)",
                  fontSize: 11,
                  textAnchor: "middle",
                }}
              />
            </YAxis>
            <ZAxis type="number" dataKey="weight" range={[80, 600]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(v: number, n: string) => {
                if (n === "x") return [`${v}%`, "Volatility"];
                if (n === "y") return [`${v}%`, "Expected Return"];
                if (n === "weight") return [`${v}%`, "Weight"];
                return [v, n];
              }}
              labelFormatter={() => ""}
            />
            {/* Frontier as a faint dashed line via Scatter+Line trick */}
            <Scatter
              data={frontier}
              fill="transparent"
              line={{
                stroke: "var(--color-muted-foreground)",
                strokeDasharray: "4 4",
                strokeWidth: 1.5,
              }}
              shape={() => <g />}
            />
            <Scatter
              data={points}
              shape={(props: { cx?: number; cy?: number; payload?: { color: string } }) => {
                const { cx, cy, payload } = props;
                if (cx == null || cy == null || !payload) return <g />;
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={10}
                    fill={payload.color}
                    fillOpacity={0.75}
                    stroke={payload.color}
                    strokeWidth={2}
                  />
                );
              }}
            />
            <ReferenceDot
              x={portfolioVol}
              y={portfolioReturn}
              r={9}
              fill="var(--color-primary)"
              stroke="var(--color-background)"
              strokeWidth={3}
              isFront
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mt-4">
        <div className="rounded-lg bg-muted/60 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Portfolio E[R]
          </div>
          <div className="text-xl font-bold text-bull tabular-nums">
            {portfolioReturn.toFixed(2)}%
          </div>
        </div>
        <div className="rounded-lg bg-muted/60 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Portfolio σ
          </div>
          <div className="text-xl font-bold tabular-nums">{portfolioVol.toFixed(2)}%</div>
        </div>
        <div className="rounded-lg bg-muted/60 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Return / Risk
          </div>
          <div className="text-xl font-bold text-primary tabular-nums">
            {(portfolioReturn / portfolioVol).toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- TAB 2: AI PREDICTION --------------------------- */

type AssetOption = {
  ticker: string;
  name: string;
  class: "Crypto" | "VN Stock" | "Gold";
  base: number;
};

const PREDICT_ASSETS: AssetOption[] = [
  { ticker: "BTC", name: "Bitcoin", class: "Crypto", base: 67000 },
  { ticker: "ETH", name: "Ethereum", class: "Crypto", base: 3400 },
  { ticker: "SOL", name: "Solana", class: "Crypto", base: 178 },
  { ticker: "VNM", name: "Vinamilk", class: "VN Stock", base: 68 },
  { ticker: "FPT", name: "FPT Corp", class: "VN Stock", base: 142 },
  { ticker: "VIC", name: "Vingroup", class: "VN Stock", base: 45 },
  { ticker: "HPG", name: "Hoa Phat Group", class: "VN Stock", base: 27 },
  { ticker: "XAU", name: "Gold Spot (USD/oz)", class: "Gold", base: 2380 },
  { ticker: "SJC", name: "Gold SJC (VND/tael)", class: "Gold", base: 84000 },
];

type ModelOption = {
  id: string;
  name: string;
  family: string;
  profileLabel: string;
  desc: string;
  bias: number; // forecast drift bias
  vol: number; // noise scale
};

const MODELS: ModelOption[] = [
  {
    id: "lstm",
    name: "LSTM Ensemble",
    family: "Deep Learning",
    profileLabel: "Kịch bản tổng hợp",
    desc: "Synthetic preset using recurrent smoothing and generated market features.",
    bias: 1.0,
    vol: 1.0,
  },
  {
    id: "transformer",
    name: "Temporal Transformer",
    family: "Deep Learning",
    profileLabel: "Kịch bản tổng hợp",
    desc: "Synthetic preset using attention-style weighting across a generated time series.",
    bias: 1.2,
    vol: 0.85,
  },
  {
    id: "prophet",
    name: "Prophet (Bayesian)",
    family: "Statistical",
    profileLabel: "Kịch bản tổng hợp",
    desc: "Synthetic preset combining generated trend, seasonality, and change points.",
    bias: 0.6,
    vol: 0.7,
  },
  {
    id: "arima",
    name: "ARIMA-GARCH",
    family: "Statistical",
    profileLabel: "Kịch bản tổng hợp",
    desc: "Synthetic preset combining autoregression and generated volatility regimes.",
    bias: 0.3,
    vol: 1.1,
  },
  {
    id: "xgb",
    name: "XGBoost Gradient Boost",
    family: "Machine Learning",
    profileLabel: "Kịch bản tổng hợp",
    desc: "Synthetic preset using generated technical and macro-style features.",
    bias: 0.8,
    vol: 0.95,
  },
];

function genPredictionData(asset: AssetOption, model: ModelOption, nonce: number) {
  // seeded pseudo-random based on asset ticker so re-renders are deterministic
  let seed = 0;
  for (const ch of `${asset.ticker}${model.id}${nonce}`) {
    seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  }
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed & 0xffff) / 0xffff;
  };

  const data: { t: string; price: number | null; predicted: number | null }[] = [];
  const driftScale = asset.base * 0.005;
  let p = asset.base * 0.94;
  for (let i = 0; i < 30; i++) {
    p += Math.sin(i / 3) * driftScale * 1.2 + (rand() - 0.45) * driftScale * 2;
    data.push({ t: `D-${30 - i}`, price: +p.toFixed(2), predicted: null });
  }
  data[data.length - 1].predicted = data[data.length - 1].price;

  let f = p;
  const forecastDrift = driftScale * 0.6 * model.bias;
  const forecastNoise = driftScale * 1.4 * model.vol;
  for (let i = 1; i <= 14; i++) {
    f += forecastDrift + Math.sin(i / 2) * driftScale * 0.7 + (rand() - 0.4) * forecastNoise;
    data.push({ t: `D+${i}`, price: null, predicted: +f.toFixed(2) });
  }
  return data;
}

function PredictTab() {
  const [assetTicker, setAssetTicker] = useState(PREDICT_ASSETS[0].ticker);
  const [modelId, setModelId] = useState(MODELS[0].id);
  const [run, setRun] = useState({
    ticker: PREDICT_ASSETS[0].ticker,
    modelId: MODELS[0].id,
    nonce: 0,
  });

  const asset = PREDICT_ASSETS.find((a) => a.ticker === assetTicker)!;
  const model = MODELS.find((m) => m.id === modelId)!;

  const ranAsset = PREDICT_ASSETS.find((a) => a.ticker === run.ticker)!;
  const ranModel = MODELS.find((m) => m.id === run.modelId)!;
  const predData = useMemo(
    () => genPredictionData(ranAsset, ranModel, run.nonce),
    [ranAsset, ranModel, run.nonce],
  );

  const lastHistorical = [...predData].reverse().find((d) => d.price !== null)?.price ?? 0;
  const lastForecast = predData[predData.length - 1].predicted ?? 0;
  const upsidePct = ((lastForecast - lastHistorical) / lastHistorical) * 100;
  const currency =
    ranAsset.class === "VN Stock"
      ? ""
      : ranAsset.class === "Gold" && ranAsset.ticker === "SJC"
        ? "₫"
        : "$";

  const fmt = (v: number) =>
    `${currency}${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
      {/* Controls */}
      <aside className="min-w-0 space-y-6 rounded-2xl border border-border bg-card p-6 lg:sticky lg:top-20 lg:self-start">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            Prediction Setup
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Pick an asset & model — forecast 14-day horizon.
          </p>
        </div>

        {/* Asset picker */}
        <div>
          <label className="text-sm font-medium block mb-1.5">Asset</label>
          <div className="relative">
            <select
              value={assetTicker}
              onChange={(e) => setAssetTicker(e.target.value)}
              className="w-full appearance-none bg-muted/60 rounded-lg px-3 py-2.5 text-sm outline-none pr-9 focus:ring-2 focus:ring-primary/50"
            >
              {(["Crypto", "VN Stock", "Gold"] as const).map((cls) => (
                <optgroup key={cls} label={cls}>
                  {PREDICT_ASSETS.filter((a) => a.class === cls).map((a) => (
                    <option key={a.ticker} value={a.ticker}>
                      {a.ticker} — {a.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
          </div>
          <div className="mt-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-primary/10 text-primary">
              <Coins className="w-3 h-3" />
              {asset.class}
            </span>
          </div>
        </div>

        {/* Model picker */}
        <div>
          <label className="text-sm font-medium block mb-2">Prediction Model</label>
          <div className="space-y-2">
            {MODELS.map((m) => {
              const sel = modelId === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setModelId(m.id)}
                  className={`w-full text-left rounded-lg border p-3 transition-all ${
                    sel
                      ? "border-primary bg-primary/5"
                      : "border-border bg-muted/30 hover:bg-muted/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">{m.name}</div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bull/10 text-bull">
                      {m.profileLabel}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-0.5">
                    {m.family}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{m.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={() => {
            setRun({ ticker: assetTicker, modelId, nonce: run.nonce + 1 });
            void queueQuantRun("AI Prediction", {
              assetTicker,
              modelId,
              horizonDays: 14,
            });
          }}
          className="w-full inline-flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-bold py-3.5 rounded-xl shadow-elegant hover:opacity-95"
        >
          <Sparkles className="w-4 h-4" />
          Run Prediction
        </button>
      </aside>

      {/* Chart */}
      <section className="min-w-0 rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <LineChartIcon className="w-4 h-4 text-primary" />
              {ranAsset.ticker} · {ranAsset.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              {ranModel.name} · 14-day synthetic scenario
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <DataStatusBadge status="SIMULATED" detail="Đường dự báo dùng dữ liệu tổng hợp." />
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-foreground" />
              Generated history
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
              <XAxis
                dataKey="t"
                stroke="var(--color-muted-foreground)"
                fontSize={11}
                interval={4}
              />
              <YAxis
                stroke="var(--color-muted-foreground)"
                fontSize={11}
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) =>
                  `${currency}${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)}`
                }
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
                formatter={(v: number) => fmt(v)}
              />
              <Line
                type="monotone"
                dataKey="price"
                name="Generated history"
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
            { l: "Scenario start", v: fmt(lastHistorical), t: "primary", icon: Activity },
            {
              l: "Target (14d)",
              v: fmt(lastForecast),
              t: upsidePct >= 0 ? "bull" : "bear",
              icon: Target,
            },
            {
              l: upsidePct >= 0 ? "Upside" : "Downside",
              v: `${upsidePct >= 0 ? "+" : ""}${upsidePct.toFixed(2)}%`,
              t: upsidePct >= 0 ? "bull" : "bear",
              icon: upsidePct >= 0 ? TrendingUp : TrendingDown,
            },
            { l: "Scenario", v: "Synthetic", t: "primary", icon: Sparkles },
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
                    k.t === "bull" ? "text-bull" : k.t === "bear" ? "text-bear" : "text-primary"
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

const BACKTEST_ASSETS: AssetOption[] = PREDICT_ASSETS;

const STRATEGY_NAMES = [
  "Trend Following (MA Cross)",
  "Mean-Reversion Z-Score",
  "Breakout Donchian-20",
  "Momentum 12-1",
  "RSI Divergence",
  "Bollinger Squeeze",
  "Smart Money Concept (SMC)",
  "Volatility Risk Premium",
];

type Leg = {
  id: number;
  assetTicker: string;
  strategy: string;
  riskMode: "fixed" | "kelly";
  fixedRisk: number;
};

let legCounter = 4;

function BacktestTab() {
  const [from, setFrom] = useState("2023-01-01");
  const [to, setTo] = useState("2025-12-31");
  const [legs, setLegs] = useState<Leg[]>([
    { id: 1, assetTicker: "BTC", strategy: STRATEGY_NAMES[0], riskMode: "fixed", fixedRisk: 2 },
    { id: 2, assetTicker: "FPT", strategy: STRATEGY_NAMES[3], riskMode: "fixed", fixedRisk: 1.5 },
    { id: 3, assetTicker: "XAU", strategy: STRATEGY_NAMES[2], riskMode: "kelly", fixedRisk: 2 },
  ]);

  const addLeg = () =>
    setLegs((ls) => [
      ...ls,
      {
        id: ++legCounter,
        assetTicker: BACKTEST_ASSETS[0].ticker,
        strategy: STRATEGY_NAMES[0],
        riskMode: "fixed",
        fixedRisk: 2,
      },
    ]);

  const removeLeg = (id: number) => setLegs((ls) => ls.filter((l) => l.id !== id));

  const update = (id: number, patch: Partial<Leg>) =>
    setLegs((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[480px_minmax(0,1fr)]">
      {/* Left: Inputs */}
      <aside className="min-w-0 space-y-6 overflow-y-auto rounded-2xl border border-border bg-card p-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-primary" />
            Multi-Asset Backtest
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Combine equity, crypto &amp; gold legs into a single portfolio test.
          </p>
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

        {/* Legs */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Portfolio Legs</label>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {legs.length} leg{legs.length !== 1 ? "s" : ""}
            </span>
          </div>

          {legs.map((leg, idx) => (
            <div
              key={leg.id}
              className="rounded-xl border border-border bg-muted/30 p-4 space-y-3 relative"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-primary font-bold">
                  Leg #{idx + 1}
                </span>
                {legs.length > 1 && (
                  <button
                    onClick={() => removeLeg(leg.id)}
                    className="text-muted-foreground hover:text-bear transition-colors"
                    aria-label="Remove leg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Asset */}
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                  Asset
                </span>
                <div className="relative mt-1">
                  <select
                    value={leg.assetTicker}
                    onChange={(e) => update(leg.id, { assetTicker: e.target.value })}
                    className="w-full appearance-none bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none pr-9"
                  >
                    {(["Crypto", "VN Stock", "Gold"] as const).map((cls) => (
                      <optgroup key={cls} label={cls}>
                        {BACKTEST_ASSETS.filter((a) => a.class === cls).map((a) => (
                          <option key={a.ticker} value={a.ticker}>
                            {a.ticker} — {a.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                </div>
              </div>

              {/* Strategy */}
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                  Strategy
                </span>
                <div className="relative mt-1">
                  <select
                    value={leg.strategy}
                    onChange={(e) => update(leg.id, { strategy: e.target.value })}
                    className="w-full appearance-none bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none pr-9"
                  >
                    {STRATEGY_NAMES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                </div>
              </div>

              {/* Risk Management */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className="w-3 h-3 text-primary" />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                    Risk Management
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => update(leg.id, { riskMode: "fixed" })}
                    className={`text-xs py-2 rounded-md border transition-colors ${
                      leg.riskMode === "fixed"
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Fixed %
                  </button>
                  <button
                    onClick={() => update(leg.id, { riskMode: "kelly" })}
                    className={`text-xs py-2 rounded-md border transition-colors ${
                      leg.riskMode === "kelly"
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Kelly
                  </button>
                </div>
                {leg.riskMode === "fixed" ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={0.1}
                      max={20}
                      step={0.1}
                      value={leg.fixedRisk}
                      onChange={(e) => update(leg.id, { fixedRisk: +e.target.value })}
                      className="w-24 bg-background border border-border rounded-md px-2.5 py-1.5 text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <span className="text-xs text-muted-foreground">% per trade</span>
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] font-mono text-muted-foreground">
                    Fractional Kelly: <span className="text-primary">0.25 ×</span> dynamic
                  </div>
                )}
              </div>
            </div>
          ))}

          <button
            onClick={addLeg}
            className="w-full inline-flex items-center justify-center gap-2 border border-dashed border-border rounded-xl py-3 text-sm font-medium text-muted-foreground hover:text-primary hover:border-primary transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Portfolio Leg
          </button>
        </div>

        <button
          onClick={() =>
            void queueQuantRun("Multi-Asset Backtest", {
              from,
              to,
              legs,
            })
          }
          className="w-full inline-flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-bold text-base py-4 rounded-xl shadow-elegant hover:opacity-95 transition-opacity"
        >
          <Play className="w-5 h-5 fill-current" />
          RUN PORTFOLIO BACKTEST
        </button>
      </aside>

      {/* Right: Output */}
      <section className="min-w-0 space-y-6">
        {/* Active legs summary */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-sm">Active Portfolio</h3>
            <div className="flex flex-wrap items-center gap-2">
              <DataStatusBadge
                status="SIMULATED"
                detail="Các kết quả backtest là dữ liệu tạo cục bộ."
              />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {legs.length} legs · {from} → {to}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {legs.map((leg, idx) => {
              const a = BACKTEST_ASSETS.find((x) => x.ticker === leg.assetTicker)!;
              return (
                <div
                  key={leg.id}
                  className="text-xs font-mono px-3 py-1.5 rounded-md bg-muted border border-border flex items-center gap-2"
                >
                  <span className="text-primary font-bold">#{idx + 1}</span>
                  <span className="font-semibold">{a.ticker}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{leg.strategy.split(" ")[0]}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-primary">
                    {leg.riskMode === "fixed" ? `${leg.fixedRisk}%` : "Kelly"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Equity Curve */}
        <EquityCurve legCount={legs.length} />

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

        <TradeList />
        <MonteCarlo />
      </section>
    </div>
  );
}

/* ------------------------------ Equity Curve ------------------------------ */

function genEquity(n: number, seed: number, drift: number, vol: number) {
  let s = seed;
  let v = 10000;
  const out: { i: number; equity: number; bench: number; dd: number }[] = [];
  let peak = v;
  let b = 10000;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = (s / 233280 - 0.5) * vol + drift;
    v = Math.max(500, v * (1 + r));
    s = (s * 9301 + 49297) % 233280;
    const rb = (s / 233280 - 0.5) * 0.012 + 0.0004;
    b = Math.max(500, b * (1 + rb));
    peak = Math.max(peak, v);
    out.push({
      i,
      equity: +v.toFixed(2),
      bench: +b.toFixed(2),
      dd: +(((v - peak) / peak) * 100).toFixed(2),
    });
  }
  return out;
}

function EquityCurve({ legCount }: { legCount: number }) {
  const data = useMemo(() => genEquity(180, 11, 0.0026, 0.022), []);
  const final = data[data.length - 1];
  const totalReturn = ((final.equity - 10000) / 10000) * 100;
  const benchReturn = ((final.bench - 10000) / 10000) * 100;
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Activity className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">Equity Curve & Drawdown</h3>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Portfolio · {legCount} legs · vs SPY
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-primary" /> Strategy{" "}
            <span className="text-bull font-mono">+{totalReturn.toFixed(1)}%</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 border-t-2 border-dashed border-muted-foreground" /> Benchmark{" "}
            <span className="text-muted-foreground font-mono">+{benchReturn.toFixed(1)}%</span>
          </span>
        </div>
      </div>
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="h-[320px] min-w-0 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="i"
                stroke="var(--color-muted-foreground)"
                fontSize={11}
                tickFormatter={(v) => `D${v}`}
                interval={20}
              />
              <YAxis
                stroke="var(--color-muted-foreground)"
                fontSize={11}
                tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="equity"
                name="Strategy"
                stroke="var(--color-primary)"
                strokeWidth={2.4}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="bench"
                name="Benchmark"
                stroke="var(--color-muted-foreground)"
                strokeWidth={1.6}
                strokeDasharray="5 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="border-l border-border p-4 space-y-3 bg-muted/20">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Drawdown
          </div>
          <div className="h-[140px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis dataKey="i" hide />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={10}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => `${v.toFixed(2)}%`}
                />
                <Line
                  type="monotone"
                  dataKey="dd"
                  stroke="var(--color-bear)"
                  strokeWidth={1.8}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md bg-card border border-border p-2">
              <div className="text-[10px] uppercase font-mono text-muted-foreground">CAGR</div>
              <div className="font-bold text-bull">+24.6%</div>
            </div>
            <div className="rounded-md bg-card border border-border p-2">
              <div className="text-[10px] uppercase font-mono text-muted-foreground">Max DD</div>
              <div className="font-bold text-bear">-12.6%</div>
            </div>
            <div className="rounded-md bg-card border border-border p-2">
              <div className="text-[10px] uppercase font-mono text-muted-foreground">Calmar</div>
              <div className="font-bold">1.95</div>
            </div>
            <div className="rounded-md bg-card border border-border p-2">
              <div className="text-[10px] uppercase font-mono text-muted-foreground">Sortino</div>
              <div className="font-bold">2.31</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Trade List ------------------------------ */

type Trade = {
  id: number;
  date: string;
  asset: string;
  side: "Long" | "Short";
  entry: number;
  exit: number;
  pnlPct: number;
  bars: number;
};

const TRADES: Trade[] = [
  {
    id: 28,
    date: "2025-11-18",
    asset: "BTC",
    side: "Long",
    entry: 64210,
    exit: 71840,
    pnlPct: 11.88,
    bars: 14,
  },
  {
    id: 27,
    date: "2025-10-30",
    asset: "FPT",
    side: "Long",
    entry: 142.5,
    exit: 138.2,
    pnlPct: -3.02,
    bars: 8,
  },
  {
    id: 26,
    date: "2025-10-12",
    asset: "XAU",
    side: "Long",
    entry: 2641,
    exit: 2820,
    pnlPct: 6.78,
    bars: 22,
  },
  {
    id: 25,
    date: "2025-09-28",
    asset: "BTC",
    side: "Short",
    entry: 68450,
    exit: 64980,
    pnlPct: 5.07,
    bars: 11,
  },
  {
    id: 24,
    date: "2025-09-10",
    asset: "FPT",
    side: "Long",
    entry: 128.0,
    exit: 142.4,
    pnlPct: 11.25,
    bars: 18,
  },
  {
    id: 23,
    date: "2025-08-22",
    asset: "XAU",
    side: "Short",
    entry: 2510,
    exit: 2548,
    pnlPct: -1.51,
    bars: 6,
  },
  {
    id: 22,
    date: "2025-08-04",
    asset: "BTC",
    side: "Long",
    entry: 58200,
    exit: 63110,
    pnlPct: 8.44,
    bars: 13,
  },
  {
    id: 21,
    date: "2025-07-19",
    asset: "FPT",
    side: "Short",
    entry: 134.2,
    exit: 130.1,
    pnlPct: 3.05,
    bars: 9,
  },
];

function TradeList() {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="p-5 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            Trade List
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Most recent executed trades from the backtest engine.
          </p>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Showing {TRADES.length} of 298
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            <tr className="border-b border-border">
              <th className="text-left px-5 py-2.5">#</th>
              <th className="text-left px-5 py-2.5">Date</th>
              <th className="text-left px-5 py-2.5">Asset</th>
              <th className="text-center px-5 py-2.5">Side</th>
              <th className="text-right px-5 py-2.5">Entry</th>
              <th className="text-right px-5 py-2.5">Exit</th>
              <th className="text-right px-5 py-2.5">Bars</th>
              <th className="text-right px-5 py-2.5">PnL %</th>
            </tr>
          </thead>
          <tbody>
            {TRADES.map((t) => {
              const win = t.pnlPct >= 0;
              return (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">{t.id}</td>
                  <td className="px-5 py-2.5 font-mono text-xs">{t.date}</td>
                  <td className="px-5 py-2.5 font-semibold">{t.asset}</td>
                  <td className="px-5 py-2.5 text-center">
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                        t.side === "Long" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                      }`}
                    >
                      {t.side}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">
                    {t.entry.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{t.exit.toLocaleString()}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">
                    {t.bars}
                  </td>
                  <td
                    className={`px-5 py-2.5 text-right tabular-nums font-bold ${
                      win ? "text-bull" : "text-bear"
                    }`}
                  >
                    {win ? "+" : ""}
                    {t.pnlPct.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------- Monte Carlo ------------------------------ */

function mcPath(n: number, seed: number, mu: number, sigma: number) {
  let s = seed;
  let v = 10000;
  const out: number[] = [v];
  for (let i = 1; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const u1 = (s + 1) / 233281;
    s = (s * 9301 + 49297) % 233280;
    const u2 = (s + 1) / 233281;
    // Box-Muller
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    v = Math.max(100, v * (1 + mu + sigma * z));
    out.push(+v.toFixed(2));
  }
  return out;
}

function MonteCarlo() {
  const [sims, setSims] = useState(50);
  const [horizon, setHorizon] = useState(120);
  const [nonce, setNonce] = useState(0);

  const { rows, finals } = useMemo(() => {
    const paths = Array.from({ length: sims }, (_, k) =>
      mcPath(horizon, 17 + k * 13 + nonce * 7, 0.0022, 0.018),
    );
    const finals = paths.map((p) => p[p.length - 1]).sort((a, b) => a - b);
    const rows = Array.from({ length: horizon }, (_, i) => {
      const r: Record<string, number> = { i };
      paths.forEach((p, k) => (r[`p${k}`] = p[i]));
      return r;
    });
    return { rows, finals };
  }, [sims, horizon, nonce]);

  const p5 = finals[Math.floor(finals.length * 0.05)];
  const p50 = finals[Math.floor(finals.length * 0.5)];
  const p95 = finals[Math.floor(finals.length * 0.95)];
  const winRate = (finals.filter((f) => f > 10000).length / finals.length) * 100;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="p-5 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Monte Carlo Simulation
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {sims} stochastic paths · {horizon}-day horizon · GBM with strategy μ/σ.
          </p>
        </div>
        <button
          onClick={() => setNonce((n) => n + 1)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-gradient-primary text-primary-foreground hover:opacity-95"
        >
          <Zap className="w-3.5 h-3.5" />
          Re-Run
        </button>
      </div>
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="h-[320px] min-w-0 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="i"
                stroke="var(--color-muted-foreground)"
                fontSize={11}
                tickFormatter={(v) => `D${v}`}
                interval={Math.floor(horizon / 6)}
              />
              <YAxis
                stroke="var(--color-muted-foreground)"
                fontSize={11}
                tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  fontSize: 11,
                }}
                formatter={(v: number) => `$${v.toLocaleString()}`}
                labelFormatter={(l) => `Day ${l}`}
              />
              {Array.from({ length: sims }).map((_, k) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={`p${k}`}
                  stroke="var(--color-primary)"
                  strokeWidth={1}
                  strokeOpacity={0.18}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="border-l border-border p-4 space-y-4 bg-muted/20">
          <div className="space-y-2">
            <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex justify-between">
              Paths <span className="text-primary font-bold">{sims}</span>
            </label>
            <input
              type="range"
              min={10}
              max={200}
              step={10}
              value={sims}
              onChange={(e) => setSims(+e.target.value)}
              className="w-full accent-primary"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex justify-between">
              Horizon (days) <span className="text-primary font-bold">{horizon}</span>
            </label>
            <input
              type="range"
              min={30}
              max={365}
              step={5}
              value={horizon}
              onChange={(e) => setHorizon(+e.target.value)}
              className="w-full accent-primary"
            />
          </div>
          <div className="pt-3 border-t border-border space-y-2">
            <Stat label="P5 (worst)" value={`$${p5.toLocaleString()}`} tone="bear" />
            <Stat label="P50 (median)" value={`$${p50.toLocaleString()}`} tone="primary" />
            <Stat label="P95 (best)" value={`$${p95.toLocaleString()}`} tone="bull" />
            <Stat
              label="Profitable"
              value={`${winRate.toFixed(0)}%`}
              tone={winRate >= 50 ? "bull" : "bear"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "bull" | "bear" | "primary";
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground font-mono uppercase tracking-wider text-[10px]">
        {label}
      </span>
      <span
        className={`font-bold tabular-nums ${
          tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-primary"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
