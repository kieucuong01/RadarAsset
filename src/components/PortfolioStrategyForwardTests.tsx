"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getStrategyForwardTests, type ForwardTest } from "@/lib/strategy-forward/client";
import { buildForwardChart } from "@/lib/strategy-forward/presentation";

export function PortfolioStrategyForwardTests() {
  const [items, setItems] = useState<ForwardTest[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getStrategyForwardTests()
      .then(setItems)
      .catch(() => setError("Không thể tải kết quả forward test."));
    return () => controller.abort();
  }, []);
  if (error)
    return (
      <section className="rounded-2xl border border-bear/30 bg-card p-6 text-sm text-bear">
        {error}
      </section>
    );
  if (!items.length)
    return (
      <section className="rounded-2xl border border-dashed bg-card p-6">
        <h2 className="font-semibold">Forward Testing</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Apply một backtest thành công để theo dõi tín hiệu mới trên Mock Portfolio.
        </p>
      </section>
    );
  return (
    <section className="space-y-4" aria-labelledby="forward-tests-title">
      <div>
        <h2 id="forward-tests-title" className="text-xl font-bold">
          Forward Testing
        </h2>
        <p className="text-sm text-muted-foreground">
          Hiệu quả từ lúc áp dụng chiến lược, không nhập giao dịch lịch sử.
        </p>
      </div>
      {items.map((item) => (
        <ForwardCard key={item.assignmentId} item={item} />
      ))}
    </section>
  );
}

function ForwardCard({ item }: { item: ForwardTest }) {
  const chart = useMemo(() => buildForwardChart(item.snapshots), [item.snapshots]);
  const latest = item.snapshots.at(-1);
  return (
    <article className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-mono text-primary">
            {item.symbol} · {item.status}
          </div>
          <h3 className="mt-1 font-semibold">
            {item.strategy.name}{" "}
            <span className="text-muted-foreground">v{item.strategy.version}</span>
          </h3>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          Dữ liệu tới
          <br />
          {item.lastEvaluatedBarAt
            ? new Date(item.lastEvaluatedBarAt).toLocaleString("vi-VN")
            : "Đang chờ"}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric
          label="PnL loại trừ góp vốn"
          value={latest ? latest.pnlExcludingContributions : 0}
        />
        <Metric label="Vốn góp định kỳ" value={latest ? latest.cumulativeContributions : 0} />
        <Metric label="Phí mô phỏng" value={latest ? latest.cumulativeFees : 0} />
      </div>
      <div className="mt-4 h-52">
        {chart.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="timestamp" hide />
              <YAxis domain={["auto", "auto"]} width={45} />
              <Tooltip />
              <Area
                dataKey="strategy"
                name="Strategy"
                stroke="var(--primary)"
                fill="var(--primary)"
                fillOpacity={0.12}
              />
              <Area
                dataKey="buyHold"
                name="Buy & Hold"
                stroke="var(--muted-foreground)"
                fillOpacity={0}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            Đang chờ snapshot dữ liệu tiếp theo.
          </div>
        )}
      </div>
      <div className="mt-3 text-sm">
        <span className="text-muted-foreground">Tín hiệu gần nhất: </span>
        {item.latestSignal ? (
          <span className={item.latestSignal.signalType === "buy" ? "text-bull" : "text-bear"}>
            {item.latestSignal.signalType === "buy" ? "Mua" : "Bán"} · {item.latestSignal.reason}
          </span>
        ) : (
          "Chưa có tín hiệu mới"
        )}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="text-[10px] font-mono uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold tabular-nums">
        {value.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 2,
        })}
      </div>
    </div>
  );
}
