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
import { buildForwardChart, buildForwardComparison } from "@/lib/strategy-forward/presentation";
import { useI18n } from "@/lib/i18n/context";

export function PortfolioStrategyForwardTests() {
  const { t } = useI18n();
  const [items, setItems] = useState<ForwardTest[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getStrategyForwardTests()
      .then(setItems)
      .catch(() => setError(t("forwardTesting.loadError")));
    return () => controller.abort();
  }, [t]);
  if (error)
    return (
      <section className="rounded-2xl border border-bear/30 bg-card p-6 text-sm text-bear">
        {error}
      </section>
    );
  if (!items.length)
    return (
      <section className="rounded-2xl border border-dashed bg-card p-6">
        <h2 className="font-semibold">{t("forwardTesting.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("forwardTesting.emptyDescription")}</p>
      </section>
    );
  return (
    <section className="space-y-4" aria-labelledby="forward-tests-title">
      <div>
        <h2 id="forward-tests-title" className="text-xl font-bold">
          {t("forwardTesting.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("forwardTesting.description")}</p>
      </div>
      {items.map((item) => (
        <ForwardCard key={item.assignmentId} item={item} />
      ))}
    </section>
  );
}

function ForwardCard({ item }: { item: ForwardTest }) {
  const { t } = useI18n();
  const chart = useMemo(() => buildForwardChart(item.snapshots), [item.snapshots]);
  const comparison = useMemo(
    () => buildForwardComparison(item.snapshots, item.backtestBaseline),
    [item.backtestBaseline, item.snapshots],
  );
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
          {t("forwardTesting.dataUntil")}
          <br />
          {item.lastEvaluatedBarAt
            ? new Date(item.lastEvaluatedBarAt).toLocaleString("vi-VN")
            : t("forwardTesting.waiting")}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric
          label={t("forwardTesting.pnlExContributions")}
          value={latest ? latest.pnlExcludingContributions : 0}
        />
        <Metric
          label={t("forwardTesting.contributions")}
          value={latest ? latest.cumulativeContributions : 0}
        />
        <Metric label={t("forwardTesting.fees")} value={latest ? latest.cumulativeFees : 0} />
      </div>
      {comparison ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <PercentMetric label={t("forwardTesting.forwardReturn")} value={comparison.forwardReturnPct} />
          <PercentMetric label={t("forwardTesting.backtestReturn")} value={comparison.backtestReturnPct} />
          <PercentMetric label={t("forwardTesting.backtestGap")} value={comparison.backtestGapPctPoints} />
        </div>
      ) : null}
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
                name={t("forwardTesting.strategy")}
                stroke="var(--primary)"
                fill="var(--primary)"
                fillOpacity={0.12}
              />
              <Area
                dataKey="buyHold"
                name={t("forwardTesting.buyHold")}
                stroke="var(--muted-foreground)"
                fillOpacity={0}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            {t("forwardTesting.waitingSnapshot")}
          </div>
        )}
      </div>
      <div className="mt-3 text-sm">
        <span className="text-muted-foreground">{t("forwardTesting.latestSignal")}: </span>
        {item.latestSignal ? (
          <span className={item.latestSignal.signalType === "buy" ? "text-bull" : "text-bear"}>
            {item.latestSignal.signalType === "buy" ? t("common.buy") : t("common.sell")} ·{" "}
            {item.latestSignal.reason}
          </span>
        ) : (
          t("forwardTesting.noSignal")
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

function PercentMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="text-[10px] font-mono uppercase text-muted-foreground">{label}</div>
      <div className={value >= 0 ? "mt-1 font-semibold tabular-nums text-bull" : "mt-1 font-semibold tabular-nums text-bear"}>
        {value >= 0 ? "+" : ""}{value.toFixed(2)}%
      </div>
    </div>
  );
}
