import { useEffect, useState } from "react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import type { MarketTickerResponse } from "@/lib/backend/types";
import { resolveTickerSnapshot, type TickerSnapshot } from "@/lib/ticker-presentation";

type Tick = { sym: string; price: number; chg: number };

const INITIAL_SNAPSHOT: TickerSnapshot<Tick> = {
  rows: [],
  status: "UNAVAILABLE",
  detail: "Đang chờ dữ liệu thị trường đã xác thực.",
};

export function TickerTape() {
  const [snapshot, setSnapshot] = useState<TickerSnapshot<Tick>>(INITIAL_SNAPSHOT);

  useEffect(() => {
    let alive = true;
    fetch("/api/market/ticker")
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("Ticker API không khả dụng.")),
      )
      .then((rows: MarketTickerResponse[]) => {
        if (!alive) return;
        const ticks = rows.map((row) => ({
          sym: row.symbol,
          price: row.price,
          chg: row.changePercent,
        }));
        setSnapshot(resolveTickerSnapshot(ticks));
      })
      .catch(() => {
        if (!alive) return;
        setSnapshot({
          rows: [],
          status: "UNAVAILABLE",
          detail: "Ticker API không khả dụng; không có dữ liệu mẫu được thay thế.",
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  const strip = [...snapshot.rows, ...snapshot.rows];

  return (
    <div className="flex min-w-0 items-center border-b border-border bg-card/40 backdrop-blur-md">
      <div className="shrink-0 px-2 sm:px-3">
        <DataStatusBadge status={snapshot.status} detail={snapshot.detail} />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="ticker-track flex min-h-9 w-max items-center gap-8 whitespace-nowrap py-2.5 will-change-transform">
          {strip.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              Chưa có dữ liệu thị trường đã xác thực.
            </span>
          ) : null}
          {strip.map((tick, index) => {
            const up = tick.chg >= 0;
            return (
              <div key={`${tick.sym}-${index}`} className="flex items-center gap-2 text-xs">
                <span className="font-bold tracking-wide">{tick.sym}</span>
                <span className="tabular-nums text-muted-foreground">
                  {tick.price.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                </span>
                <span className={`tabular-nums font-semibold ${up ? "text-bull" : "text-bear"}`}>
                  {up ? "▲" : "▼"} {Math.abs(tick.chg).toFixed(2)}%
                </span>
                <span className="text-border">|</span>
              </div>
            );
          })}
        </div>
      </div>
      <style>{`
        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-track {
          animation: ticker-scroll 60s linear infinite;
        }
        .ticker-track:hover {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .ticker-track {
            animation: none;
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
