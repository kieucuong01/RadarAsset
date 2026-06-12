import { Play, TrendingUp, TrendingDown, Minus, ArrowRight, Sparkles, Brain, ShieldAlert, Target, CheckCircle2 } from "lucide-react";

const today = new Date().toLocaleDateString("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const tickers = [
  { sym: "BTC", price: "67,420", chg: 2.5 },
  { sym: "ETH", price: "3,512", chg: 1.8 },
  { sym: "SPY", price: "528.10", chg: -0.4 },
  { sym: "QQQ", price: "452.30", chg: -0.6 },
  { sym: "VN30", price: "1,328", chg: 1.2 },
  { sym: "GOLD", price: "2,402", chg: 0.7 },
  { sym: "DXY", price: "104.21", chg: -0.2 },
  { sym: "WTI", price: "78.45", chg: 1.1 },
];

const articles = [
  {
    src: "CRYPTOQUANT",
    sentiment: "bull" as const,
    title: "BTC Spot ETF inflows hit 3-week high as whales reload positions",
    summary:
      "On-chain data shows accumulation addresses gaining 18,400 BTC over the past week — historically a precursor to upward continuation.",
  },
  {
    src: "SSI RESEARCH",
    sentiment: "bull" as const,
    title: "VN30 banking sector projected to lead Q3 earnings rebound",
    summary:
      "Credit growth recovery and stable NIM support double-digit profit growth for top-tier Vietnamese lenders this quarter.",
  },
  {
    src: "FED MINUTES",
    sentiment: "bear" as const,
    title: "Hawkish tilt: officials see fewer cuts in 2026 than markets price",
    summary:
      "Stickier core services inflation pushes the dot plot higher, raising real-yield risk for high-duration tech and growth equities.",
  },
  {
    src: "GOLDMAN SACHS",
    sentiment: "neutral" as const,
    title: "Equities range-bound as earnings season delivers mixed signals",
    summary:
      "Beat rates remain healthy but guidance softens. GS keeps year-end S&P target at 5,600 with balanced sector positioning.",
  },
  {
    src: "GLASSNODE",
    sentiment: "bull" as const,
    title: "Long-term holders supply hits all-time high — supply squeeze ahead?",
    summary:
      "76% of BTC supply has not moved in over a year. Diminishing sell-side liquidity could amplify price moves on incremental demand.",
  },
  {
    src: "BLOOMBERG",
    sentiment: "bear" as const,
    title: "Oil slides as OPEC+ signals gradual unwind of voluntary cuts",
    summary:
      "WTI tests $77 support. Energy equities underperform as analysts cut Q4 EPS estimates across mid-cap producers.",
  },
];

function SentimentBadge({ s }: { s: "bull" | "bear" | "neutral" }) {
  const map = {
    bull: { label: "Bullish", color: "text-bull bg-bull/10 border-bull/20", Icon: TrendingUp },
    bear: { label: "Bearish", color: "text-bear bg-bear/10 border-bear/20", Icon: TrendingDown },
    neutral: { label: "Neutral", color: "text-muted-foreground bg-muted border-border", Icon: Minus },
  } as const;
  const { label, color, Icon } = map[s];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${color}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function FearGreedGauge({ value }: { value: number }) {
  // Half circle gauge using SVG
  const angle = (value / 100) * 180;
  const r = 70;
  const cx = 90;
  const cy = 90;
  const rad = ((180 - angle) * Math.PI) / 180;
  const x = cx + r * Math.cos(rad);
  const y = cy - r * Math.sin(rad);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 180 110" className="w-44 h-28">
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.66 0.22 18)" />
            <stop offset="50%" stopColor="oklch(0.7 0.16 70)" />
            <stop offset="100%" stopColor="oklch(0.72 0.17 155)" />
          </linearGradient>
        </defs>
        <path
          d={`M 20 90 A ${r} ${r} 0 0 1 160 90`}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <line x1={cx} y1={cy} x2={x} y2={y} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="6" fill="currentColor" />
      </svg>
      <div className="text-center -mt-2">
        <div className="text-3xl font-bold">{value}</div>
        <div className="text-xs font-medium text-bull">Greed</div>
      </div>
    </div>
  );
}

export function SmartInsights() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      {/* Hero / Daily Briefing */}
      <section
        className="relative overflow-hidden rounded-3xl p-8 md:p-12 text-primary-foreground shadow-elegant"
        style={{ backgroundImage: "var(--gradient-hero)" }}
      >
        <div className="absolute inset-0 opacity-30 mix-blend-overlay pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle at 80% 20%, white, transparent 40%)" }} />
        <div className="relative grid md:grid-cols-[1fr_auto] gap-8 items-center">
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold tracking-widest px-3 py-1 rounded-full bg-white/15 backdrop-blur">
                <Sparkles className="w-3.5 h-3.5" /> DAILY BRIEFING
              </span>
              <span className="text-sm text-white/80">{today}</span>
            </div>
            <h1 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight max-w-2xl">
              Risk-on returns as BTC reclaims $67K, but Fed minutes cap upside in equities.
            </h1>
            <ul className="space-y-2 text-white/90 max-w-2xl">
              <li className="flex gap-3"><span className="text-bull">▲</span> Crypto: ETF inflows accelerate; BTC dominance climbs to 56.4%.</li>
              <li className="flex gap-3"><span className="text-bear">▼</span> Macro: Hawkish FOMC minutes lift 10Y yields to 4.32%.</li>
              <li className="flex gap-3"><span className="text-bull">▲</span> Equities: VN30 +1.2% led by banking; SPY drifts on rate concerns.</li>
            </ul>
          </div>
          <button className="group flex items-center gap-4 bg-white/10 hover:bg-white/20 backdrop-blur rounded-2xl px-5 py-4 transition-all border border-white/20">
            <span className="w-14 h-14 rounded-full bg-white text-primary grid place-items-center shadow-glow group-hover:scale-105 transition-transform">
              <Play className="w-6 h-6 fill-current ml-0.5" />
            </span>
            <span className="text-left">
              <span className="block text-sm font-semibold">Listen to AI Briefing</span>
              <span className="block text-xs text-white/70">3 min · Premium voice</span>
            </span>
          </button>
        </div>
      </section>

      {/* Market Pulse */}
      <section className="grid lg:grid-cols-[320px_1fr] gap-6">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Fear &amp; Greed Index</h3>
            <span className="text-xs text-muted-foreground">Updated 5m ago</span>
          </div>
          <FearGreedGauge value={75} />
          <p className="text-xs text-muted-foreground text-center mt-3">
            Investors are showing strong risk appetite — historically a contrarian caution signal.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Trending Assets</h3>
            <span className="text-xs text-muted-foreground">Live</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {tickers.map((t) => {
              const up = t.chg >= 0;
              return (
                <div
                  key={t.sym}
                  className="shrink-0 min-w-[140px] rounded-xl border border-border bg-background/50 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">{t.sym}</span>
                    <span className={`text-xs font-semibold ${up ? "text-bull" : "text-bear"}`}>
                      {up ? "+" : ""}{t.chg}%
                    </span>
                  </div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{t.price}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* AI News Feed */}
      <section>
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Expert Signals</h2>
            <p className="text-sm text-muted-foreground">AI-curated insights from top research desks worldwide.</p>
          </div>
          <button className="hidden md:inline-flex text-sm font-medium text-primary hover:underline">
            View all
          </button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {articles.map((a, i) => (
            <article
              key={i}
              className="group rounded-2xl border border-border bg-card p-5 hover:shadow-elegant hover:-translate-y-0.5 transition-all flex flex-col"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold tracking-widest text-muted-foreground">{a.src}</span>
                <SentimentBadge s={a.sentiment} />
              </div>
              <h3 className="font-semibold text-lg leading-snug line-clamp-2 mb-2">{a.title}</h3>
              <p className="text-sm text-muted-foreground line-clamp-3 flex-1">{a.summary}</p>
              <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-primary">
                Read more
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
