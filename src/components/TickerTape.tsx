import { useEffect, useState } from "react";

type Tick = { sym: string; price: number; chg: number };

const SEED: Tick[] = [
  { sym: "BTC", price: 67420, chg: 2.5 },
  { sym: "ETH", price: 3512, chg: 1.8 },
  { sym: "SOL", price: 168.4, chg: 3.2 },
  { sym: "SPX", price: 5328.1, chg: -0.4 },
  { sym: "NDX", price: 18620, chg: -0.6 },
  { sym: "VN30", price: 1328.2, chg: 1.2 },
  { sym: "VNINDEX", price: 1284.5, chg: 0.9 },
  { sym: "GOLD", price: 2402, chg: 0.7 },
  { sym: "DXY", price: 104.21, chg: -0.2 },
  { sym: "WTI", price: 78.45, chg: 1.1 },
  { sym: "EURUSD", price: 1.0843, chg: 0.15 },
  { sym: "US10Y", price: 4.32, chg: 0.03 },
];

// Small deterministic flicker on the client so the tape feels live but
// without SSR hydration mismatch (initial render = SEED).
function jitter(prev: Tick[], step: number): Tick[] {
  return prev.map((t, i) => {
    const seed = Math.sin(step * 9.7 + i * 13.3);
    const delta = (seed * t.price) / 4000;
    const next = +(t.price + delta).toFixed(t.price > 100 ? 2 : 4);
    const chgDelta = +(seed / 80).toFixed(2);
    return { ...t, price: next, chg: +(t.chg + chgDelta).toFixed(2) };
  });
}

export function TickerTape() {
  const [ticks, setTicks] = useState<Tick[]>(SEED);

  useEffect(() => {
    let step = 0;
    const id = window.setInterval(() => {
      step += 1;
      setTicks((prev) => jitter(prev, step));
    }, 2200);
    return () => window.clearInterval(id);
  }, []);

  // Duplicate the strip so the CSS marquee loops seamlessly.
  const strip = [...ticks, ...ticks];

  return (
    <div className="border-b border-border bg-card/40 backdrop-blur-md overflow-hidden">
      <div className="max-w-[100vw] relative">
        <div className="ticker-track flex items-center gap-8 py-2.5 whitespace-nowrap will-change-transform">
          {strip.map((t, i) => {
            const up = t.chg >= 0;
            return (
              <div key={`${t.sym}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="font-bold tracking-wide">{t.sym}</span>
                <span className="tabular-nums text-muted-foreground">
                  {t.price.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                </span>
                <span
                  className={`tabular-nums font-semibold ${
                    up ? "text-bull" : "text-bear"
                  }`}
                >
                  {up ? "▲" : "▼"} {Math.abs(t.chg).toFixed(2)}%
                </span>
                <span className="text-border">|</span>
              </div>
            );
          })}
        </div>
      </div>
      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-track {
          animation: ticker-scroll 60s linear infinite;
        }
        .ticker-track:hover { animation-play-state: paused; }
      `}</style>
    </div>
  );
}
