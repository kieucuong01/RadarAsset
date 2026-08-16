"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { formatMetricValue, formatNumber } from "@/lib/financial-format";
import type { EnergyPulseModel } from "@/lib/smart-insights-client";

import type { MacroPulseState } from "./MacroQuantPulseTabs";

function dateLabel(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

export function EnergyPulsePanel({
  data,
  state,
  locale,
}: {
  data: EnergyPulseModel | null;
  state: MacroPulseState;
  locale: "vi" | "en";
}) {
  if (state === "loading" || state === "idle")
    return <div className="h-[420px] animate-pulse rounded-2xl border bg-muted/30" />;
  if (!data || state === "failed")
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Energy Pulse</h3>
          <DataStatusBadge status="UNAVAILABLE" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Chưa có dữ liệu EIA/BIS đạt kiểm định; hệ thống không tạo dữ liệu thay thế.
        </p>
      </section>
    );
  return (
    <section className="min-w-0 space-y-5 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Energy &amp; Oil Shock</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Giá dầu, spread và shock score · {data.methodology}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DataStatusBadge status={data.status === "UNAVAILABLE" ? "UNAVAILABLE" : "SYSTEM"} />
          <span className="text-xs font-medium text-muted-foreground">{data.status}</span>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.cards.slice(0, 4).map((card) => (
          <article key={card.code} className="rounded-xl border bg-background/50 p-4">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
              {formatMetricValue(card.value, { locale, unit: card.unit })}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {card.asOf ? `As of ${dateLabel(card.asOf, locale)}` : "Unavailable"}
            </p>
          </article>
        ))}
      </div>
      <div className="min-w-0 rounded-xl border bg-background/40 p-3">
        <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>Brent &amp; WTI · unit: USD/barrel</span>
          <time dateTime={data.asOf}>As of {dateLabel(data.asOf, locale)}</time>
        </div>
        <div className="h-[300px] min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data.priceSeries}
              margin={{ top: 12, right: 12, left: -10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.24} />
              <XAxis
                dataKey="ts"
                tickFormatter={(value: string) => dateLabel(value, locale)}
                fontSize={11}
                minTickGap={28}
              />
              <YAxis
                fontSize={11}
                tickFormatter={(value: number) => formatNumber(value, { maximumFractionDigits: 2 })}
              />
              <Tooltip
                labelFormatter={(value) => dateLabel(String(value), locale)}
                formatter={(value, name) => [
                  formatMetricValue(value == null ? null : Number(value), {
                    locale,
                    unit: "USD/barrel",
                  }),
                  name === "brent" ? "Brent USD/barrel" : "WTI USD/barrel",
                ]}
              />
              <Line
                type="monotone"
                dataKey="brent"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="wti"
                stroke="var(--chart-2)"
                strokeWidth={2.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="space-y-3 md:hidden">
        {data.evidence.slice(0, 20).map((row) => (
          <div key={row.observationId} className="rounded-xl border bg-background/40 p-3 text-sm">
            <strong>{row.metricCode}</strong>
            <p className="mt-1 text-xs text-muted-foreground">
              {row.sourceCode} · {dateLabel(row.observedAt, locale)}
            </p>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Metric</th>
              <th className="px-4 py-2 text-left">Nguồn</th>
              <th className="px-4 py-2 text-left">Observed</th>
              <th className="px-4 py-2 text-right">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {data.evidence.slice(0, 50).map((row) => (
              <tr key={row.observationId} className="border-t">
                <td className="px-4 py-2 font-medium">{row.metricCode}</td>
                <td className="px-4 py-2">{row.sourceCode}</td>
                <td className="px-4 py-2">{dateLabel(row.observedAt, locale)}</td>
                <td className="px-4 py-2 text-right">System data</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
