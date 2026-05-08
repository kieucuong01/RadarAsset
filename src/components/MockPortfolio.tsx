import { TrendingUp, TrendingDown, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

type Holding = {
  ticker: string;
  name: string;
  qty: number;
  price: number;
  cost: number;
  alloc: number;
};

const holdings: Holding[] = [
  { ticker: "BTC", name: "Bitcoin", qty: 0.85, price: 67420, cost: 54200, alloc: 38 },
  { ticker: "ETH", name: "Ethereum", qty: 12.4, price: 3512, cost: 2980, alloc: 22 },
  { ticker: "SPY", name: "S&P 500 ETF", qty: 45, price: 528.1, cost: 510.2, alloc: 18 },
  { ticker: "NVDA", name: "NVIDIA Corp.", qty: 28, price: 1142.5, cost: 720.3, alloc: 12 },
  { ticker: "VN30", name: "VN30 Index Fund", qty: 1200, price: 1.328, cost: 1.21, alloc: 7 },
  { ticker: "GOLD", name: "Gold (oz)", qty: 8, price: 2402, cost: 2180, alloc: 3 },
];

export function MockPortfolio() {
  const [hide, setHide] = useState(false);
  const totalValue = holdings.reduce((s, h) => s + h.qty * h.price, 0);
  const totalCost = holdings.reduce((s, h) => s + h.qty * h.cost, 0);
  const totalPnL = totalValue - totalCost;
  const totalPnLPct = (totalPnL / totalCost) * 100;
  const day = 2.4;

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Balance overview */}
      <section className="rounded-3xl p-8 md:p-10 border border-border bg-card shadow-elegant">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              Total Balance
              <button onClick={() => setHide(!hide)} className="hover:text-foreground">
                {hide ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="mt-2 text-5xl md:text-7xl font-bold tracking-tight tabular-nums">
              {hide ? "••••••" : fmt(totalValue)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className={`inline-flex items-center gap-1 text-sm font-semibold px-3 py-1 rounded-full ${
                day >= 0 ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
              }`}>
                {day >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {day >= 0 ? "+" : ""}{day}% · 24h
              </span>
              <span className="text-sm text-muted-foreground">
                Total PnL: <span className={totalPnL >= 0 ? "text-bull" : "text-bear"}>
                  {totalPnL >= 0 ? "+" : ""}{fmt(totalPnL)} ({totalPnLPct.toFixed(2)}%)
                </span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 min-w-[280px]">
            {[
              { l: "Cost Basis", v: fmt(totalCost) },
              { l: "Holdings", v: holdings.length.toString() },
              { l: "Cash", v: fmt(8420) },
            ].map((s) => (
              <div key={s.l} className="rounded-xl bg-muted/60 p-4">
                <div className="text-xs text-muted-foreground">{s.l}</div>
                <div className="mt-1 font-semibold tabular-nums">{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Holdings */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold">Holdings</h2>
          <span className="text-xs text-muted-foreground">{holdings.length} assets</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left font-medium px-5 py-3">Asset</th>
                <th className="text-right font-medium px-5 py-3">Quantity</th>
                <th className="text-right font-medium px-5 py-3">Price</th>
                <th className="text-left font-medium px-5 py-3 min-w-[200px]">Allocation</th>
                <th className="text-right font-medium px-5 py-3">PnL</th>
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
                    <td className="text-right tabular-nums px-5 py-4">{h.qty}</td>
                    <td className="text-right tabular-nums px-5 py-4">
                      <div>${h.price.toLocaleString("en-US")}</div>
                      <div className="text-xs text-muted-foreground">{fmt(value)}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-gradient-primary"
                            style={{ width: `${h.alloc}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold tabular-nums w-10 text-right">{h.alloc}%</span>
                      </div>
                    </td>
                    <td className="text-right px-5 py-4">
                      <div className={`font-semibold tabular-nums ${up ? "text-bull" : "text-bear"}`}>
                        {up ? "+" : ""}{fmt(pnl)}
                      </div>
                      <div className={`text-xs tabular-nums ${up ? "text-bull" : "text-bear"}`}>
                        {up ? "+" : ""}{pnlPct.toFixed(2)}%
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
