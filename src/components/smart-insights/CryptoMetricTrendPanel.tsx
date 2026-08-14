"use client";

import { ExternalLink } from "lucide-react";
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
import type { CryptoMetricSeries } from "@/lib/crypto-quant-pulse";
import { mergeSeriesPoints } from "@/lib/crypto-quant-pulse";
import { FreshnessBadge } from "./FreshnessBadge";

const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function dateLabel(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function metricLabel(series: CryptoMetricSeries) {
  const name = series.metricCode
    .replace(/^crypto\.(?:onchain|derivatives|stablecoin)\./, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return series.asset ? `${series.asset} · ${name}` : name;
}

function formatMetric(value: number, unit: string, locale: "vi" | "en") {
  if (unit === "return" || unit === "ratio_change") {
    return new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US", {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US", {
    notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);
}

function TrendChart({ series, locale }: { series: CryptoMetricSeries[]; locale: "vi" | "en" }) {
  const chartSeries = series.filter((item) => item.trendPoints.length >= 2);
  const chartRows = mergeSeriesPoints(chartSeries);
  if (!chartRows.length) return null;

  return (
    <div className="mt-4 h-64 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartRows} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.24} />
          <XAxis
            dataKey="effectiveAt"
            tickFormatter={(value: string) => dateLabel(value, locale)}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            fontSize={11}
          />
          <YAxis
            fontSize={11}
            width={56}
            tickFormatter={(value) => formatMetric(value, series[0].unit, locale)}
          />
          <Tooltip
            labelFormatter={(value) => dateLabel(String(value), locale)}
            formatter={(value, name) => [
              value == null ? "—" : formatMetric(Number(value), series[0].unit, locale),
              metricLabel(series.find((item) => item.key === name) ?? series[0]),
            ]}
          />
          {chartSeries.map((item, index) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.key}
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              strokeWidth={2.25}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CryptoMetricTrendPanel({
  title,
  description,
  series,
  emptyDescription,
  locale,
}: {
  title: string;
  description: string;
  series: CryptoMetricSeries[];
  emptyDescription: string;
  locale: "vi" | "en";
}) {
  if (!series.length) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          <DataStatusBadge status="UNAVAILABLE" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{emptyDescription}</p>
      </section>
    );
  }

  const byUnit = new Map<string, CryptoMetricSeries[]>();
  for (const item of series) byUnit.set(item.unit, [...(byUnit.get(item.unit) ?? []), item]);

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <DataStatusBadge status="SYSTEM" />
      </div>

      {[...byUnit.entries()].map(([unit, unitSeries]) => (
        <div key={unit} className="mt-5 min-w-0 first:mt-4">
          <div className="flex flex-wrap gap-2" aria-label={`${title} legend`}>
            {unitSeries.map((item, index) => (
              <span
                key={item.key}
                className="inline-flex items-center gap-2 text-xs text-muted-foreground"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
                />
                {metricLabel(item)}
              </span>
            ))}
          </div>
          <TrendChart series={unitSeries} locale={locale} />
        </div>
      ))}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {series.map((item) => (
          <article key={item.key} className="rounded-xl border bg-background/50 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-muted-foreground">{metricLabel(item)}</p>
              <FreshnessBadge state={item.latest.freshness} />
            </div>
            <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
              {formatMetric(item.latest.value, item.unit, locale)}{" "}
              <span className="text-xs font-normal text-muted-foreground">{item.unit}</span>
            </p>
            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <time dateTime={item.latest.effectiveAt}>
                {dateLabel(item.latest.effectiveAt, locale)}
              </time>
              <a
                href={item.latest.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
                title={item.latest.sourceCode}
              >
                <span className="truncate">{item.latest.sourceCode}</span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
