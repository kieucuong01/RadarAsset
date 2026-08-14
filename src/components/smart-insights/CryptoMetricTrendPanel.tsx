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

import { FreshnessBadge } from "@/components/smart-insights/FreshnessBadge";
import { buildCryptoMetricSeries } from "@/lib/crypto-quant-pulse";
import type { MetricModel } from "@/lib/smart-insights-client";

function dateLabel(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function metricLabel(code: string): string {
  return code
    .replace(/^crypto\./, "")
    .split(".")
    .map((part) => part.replaceAll("_", " "))
    .join(" · ");
}

export function CryptoMetricTrendPanel({
  title,
  description,
  metrics,
  metricCodes,
  locale,
}: {
  title: string;
  description: string;
  metrics: MetricModel[];
  metricCodes: ReadonlySet<string>;
  locale: "vi" | "en";
}) {
  const seriesGroups = buildCryptoMetricSeries(
    metrics.filter((metric) => metricCodes.has(metric.metricCode)),
  );

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>

      {!seriesGroups.length ? (
        <div className="mt-5 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Unavailable
        </div>
      ) : (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {seriesGroups.map((series) => {
            const latest = series.points.at(-1)!;
            return (
              <article key={series.key} className="min-w-0 rounded-xl border bg-background/50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold" title={series.metricCode}>
                      {metricLabel(series.metricCode)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {series.asset ?? "Global"} · {series.unit}
                    </p>
                  </div>
                  <FreshnessBadge state={series.freshness} />
                </div>

                {series.trendPoints.length ? (
                  <div className="mt-4 h-52 min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={series.trendPoints}
                        margin={{ top: 8, right: 10, left: -12, bottom: 0 }}
                      >
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
                          unit={series.unit === "percent" ? "%" : ""}
                        />
                        <Tooltip
                          labelFormatter={(value) => dateLabel(String(value), locale)}
                          formatter={(value) => [
                            `${Number(value).toLocaleString()} ${series.unit}`,
                            series.asset ?? "Global",
                          ]}
                        />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2.5}
                          dot={false}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="mt-5 font-mono text-3xl font-semibold tabular-nums">
                    {latest.value.toLocaleString()} {series.unit}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <time dateTime={latest.effectiveAt}>{dateLabel(latest.effectiveAt, locale)}</time>
                  <a
                    href={series.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {series.sourceCode} <ExternalLink className="size-3" />
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
