"use client";

import { ExternalLink } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import type { CryptoMarketPulseModel } from "@/lib/crypto-market-pulse-client";
import { formatMetricValue, formatNumber } from "@/lib/financial-format";

export type CryptoPanelMode = "loading" | "system" | "sample" | "unavailable";

const ALTERNATIVE_URL = "https://alternative.me/crypto/fear-and-greed-index/";
const FEAR_GREED_SAMPLE: CryptoMarketPulseModel["fearGreed"] = {
  status: "system",
  sourceCode: "alternative-fng",
  sourceUrl: ALTERNATIVE_URL,
  latest: { effectiveAt: "2026-08-14T00:00:00.000Z", value: 48, classification: "Neutral" },
  series: Array.from({ length: 30 }, (_, index) => {
    const value = Math.round(36 + Math.sin(index / 4) * 12 + index / 3);
    return {
      effectiveAt: new Date(Date.UTC(2026, 6, 16 + index)).toISOString(),
      value,
      classification:
        value <= 24
          ? "Extreme Fear"
          : value <= 44
            ? "Fear"
            : value <= 54
              ? "Neutral"
              : value <= 74
                ? "Greed"
                : "Extreme Greed",
    };
  }),
};

function dateLabel(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

export function CryptoFearGreedPanel({
  data,
  mode,
  locale,
}: {
  data: CryptoMarketPulseModel["fearGreed"] | null;
  mode: CryptoPanelMode;
  locale: "vi" | "en";
}) {
  if (mode === "loading") {
    return <div className="h-[360px] animate-pulse rounded-2xl border bg-muted/30" />;
  }

  const visible = mode === "sample" ? FEAR_GREED_SAMPLE : data;
  if (mode === "unavailable" || !visible?.series.length || !visible.latest) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Chỉ số Sợ hãi & Tham lam</h3>
          <DataStatusBadge status="UNAVAILABLE" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Chưa có quan sát Alternative.me đạt kiểm định trong cửa sổ 30 ngày.
        </p>
      </section>
    );
  }

  const latest = visible.latest;
  const tableRows = visible.series.slice(-7).reverse();
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Chỉ số Sợ hãi & Tham lam</h3>
          <p className="mt-1 text-xs text-muted-foreground">Xu hướng 30 ngày · Alternative.me</p>
        </div>
        <div className="flex items-center gap-2">
          <DataStatusBadge status={mode === "sample" ? "SAMPLE" : "SYSTEM"} />
          {mode === "sample" ? <span className="text-xs text-chart-4">Dữ liệu mẫu</span> : null}
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
        <FearGreedGauge value={latest.value} label={latest.classification} locale={locale} />
        <div className="h-[280px] min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visible.series} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.24} />
              <ReferenceArea y1={0} y2={24} fill="#ef4444" fillOpacity={0.06} />
              <ReferenceArea y1={25} y2={44} fill="#f97316" fillOpacity={0.06} />
              <ReferenceArea y1={45} y2={54} fill="#eab308" fillOpacity={0.06} />
              <ReferenceArea y1={55} y2={74} fill="#84cc16" fillOpacity={0.06} />
              <ReferenceArea y1={75} y2={100} fill="#22c55e" fillOpacity={0.06} />
              <XAxis
                dataKey="effectiveAt"
                tickFormatter={(value: string) => dateLabel(value, locale)}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                fontSize={11}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(value: number) => formatNumber(value, { maximumFractionDigits: 2 })}
                fontSize={11}
              />
              <Tooltip
                labelFormatter={(value) => dateLabel(String(value), locale)}
                formatter={(value) => [
                  formatMetricValue(value == null ? null : Number(value), {
                    locale,
                    unit: "INDEX",
                  }),
                  "Fear & Greed",
                ]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                dot={
                  visible.series.length === 1
                    ? {
                        r: 3,
                        fill: "var(--chart-1)",
                        stroke: "var(--background)",
                        strokeWidth: 2,
                      }
                    : false
                }
                activeDot={{ r: 4, fill: "var(--chart-1)" }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border">
        <table className="min-w-[620px] w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Ngày</th>
              <th className="px-4 py-2 text-right font-medium">Chỉ số</th>
              <th className="px-4 py-2 text-left font-medium">Phân loại</th>
              <th className="px-4 py-2 text-left font-medium">Trạng thái</th>
              <th className="px-4 py-2 text-right font-medium">Nguồn</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.effectiveAt} className="border-t">
                <td className="px-4 py-2 tabular-nums">{dateLabel(row.effectiveAt, locale)}</td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">
                  {formatMetricValue(row.value, { locale, unit: "INDEX" })}
                </td>
                <td className="px-4 py-2">{row.classification}</td>
                <td className="px-4 py-2">
                  <DataStatusBadge status={mode === "sample" ? "SAMPLE" : "SYSTEM"} />
                </td>
                <td className="px-4 py-2 text-right">
                  <a
                    href={visible.sourceUrl || ALTERNATIVE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Alternative.me <ExternalLink className="size-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FearGreedGauge({
  value,
  label,
  locale,
}: {
  value: number;
  label: string;
  locale: "vi" | "en";
}) {
  const radius = 70;
  const angle = (Math.max(0, Math.min(100, value)) / 100) * 180;
  const radians = ((180 - angle) * Math.PI) / 180;
  const x = 90 + radius * Math.cos(radians);
  const y = 90 - radius * Math.sin(radians);
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 180 110" className="h-32 w-52" aria-label={`Fear and Greed ${value}`}>
        <defs>
          <linearGradient id="cryptoFearGreedGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="50%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        <path
          d={`M 20 90 A ${radius} ${radius} 0 0 1 160 90`}
          fill="none"
          stroke="url(#cryptoFearGreedGradient)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <line x1="90" y1="90" x2={x} y2={y} stroke="currentColor" strokeWidth="3" />
        <circle cx="90" cy="90" r="6" fill="currentColor" />
      </svg>
      <div className="-mt-3 text-center">
        <p className="text-3xl font-bold tabular-nums">
          {formatMetricValue(value, { locale, unit: "INDEX" })}
        </p>
        <p className="text-xs font-semibold text-primary">{label}</p>
      </div>
    </div>
  );
}
