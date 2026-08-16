"use client";

import { ExternalLink } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import type { CryptoMarketPulseModel } from "@/lib/crypto-market-pulse-client";
import { formatMetricValue, formatNumber, formatPercent } from "@/lib/financial-format";
import { cn } from "@/lib/utils";
import type { CryptoPanelMode } from "./CryptoFearGreedPanel";

const COINSHARES_URL = "https://coinshares.com/corp/resources/market-activity/";
const COLORS = ["#f59e0b", "#6366f1", "#14b8a6", "#ec4899", "#8b5cf6", "#64748b"];

export const COINSHARES_SAMPLE_12_WEEKS: CryptoMarketPulseModel["fundFlows"]["series"] = Array.from(
  { length: 12 },
  (_, index) => {
    const bitcoin = Math.round((45 + Math.sin(index / 2) * 85) * 1_000_000);
    const ethereum = Math.round((8 + Math.cos(index / 3) * 28) * 1_000_000);
    const solana = Math.round((3 + Math.sin(index) * 9) * 1_000_000);
    const multiAsset = Math.round((-2 + Math.cos(index / 2) * 7) * 1_000_000);
    return {
      effectiveAt: new Date(Date.UTC(2026, 4, 29 + index * 7)).toISOString(),
      total: bitcoin + ethereum + solana + multiAsset,
      assets: [
        { label: "Bitcoin", value: bitcoin },
        { label: "Ethereum", value: ethereum },
        { label: "Solana", value: solana },
        { label: "Multi-asset", value: multiAsset },
      ],
    };
  },
);

function dateLabel(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function formatFlow(value: number, locale: "vi" | "en"): string {
  return formatMetricValue(value / 1_000_000, { locale, unit: "USD_MILLION" });
}

export function CryptoFundFlowPanel({
  data,
  mode,
  locale,
}: {
  data: CryptoMarketPulseModel["fundFlows"] | null;
  mode: CryptoPanelMode;
  locale: "vi" | "en";
}) {
  if (mode === "loading") {
    return <div className="h-[440px] animate-pulse rounded-2xl border bg-muted/30" />;
  }

  const isSample = mode === "sample";
  const series = isSample ? COINSHARES_SAMPLE_12_WEEKS : (data?.series ?? []);
  const latestBreakdown = isSample
    ? [...(series.at(-1)?.assets ?? [])].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    : (data?.latestBreakdown ?? []);
  const labels = [...new Set(series.flatMap((row) => row.assets.map((asset) => asset.label)))];
  const chartData = series.map((row) => ({
    effectiveAt: row.effectiveAt,
    total: row.total,
    ...Object.fromEntries(row.assets.map((asset) => [asset.label, asset.value])),
  }));

  if (!series.length) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">CoinShares Fund Flows</h3>
          <DataStatusBadge status="UNAVAILABLE" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          CoinShares chưa có quan sát đạt kiểm định OCR để công bố.
        </p>
      </section>
    );
  }

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">CoinShares Fund Flows</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Dòng vốn tài sản số · 12 tuần báo cáo
          </p>
        </div>
        <DataStatusBadge status={isSample ? "SAMPLE" : "SYSTEM"} />
      </div>
      {isSample ? (
        <p className="mt-3 rounded-lg border border-chart-4/30 bg-chart-4/10 px-3 py-2 text-xs text-chart-4">
          Dữ liệu mẫu — CoinShares chưa có quan sát đạt kiểm định OCR để công bố.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {labels.map((label, index) => (
          <span key={label} className="inline-flex items-center gap-2">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            {label}
          </span>
        ))}
      </div>

      <div className="mt-3 h-[320px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            stackOffset="sign"
            margin={{ top: 12, right: 12, left: 4, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.24} />
            <XAxis
              dataKey="effectiveAt"
              tickFormatter={(value: string) => dateLabel(value, locale)}
              tickLine={false}
              axisLine={false}
              fontSize={11}
            />
            <YAxis
              tickFormatter={(value: number) =>
                formatNumber(value / 1_000_000, { maximumFractionDigits: 2 })
              }
              fontSize={11}
              width={52}
            />
            <Tooltip
              labelFormatter={(value) => dateLabel(String(value), locale)}
              formatter={(value) => formatFlow(Number(value), locale)}
            />
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
            {labels.map((label, index) => (
              <Bar
                key={label}
                dataKey={label}
                stackId="fund-flow"
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border">
        <table className="min-w-[520px] w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Tài sản</th>
              <th className="px-4 py-2 text-right font-medium">Tuần mới nhất</th>
              <th className="px-4 py-2 text-right font-medium">Tỷ trọng dòng vốn</th>
            </tr>
          </thead>
          <tbody>
            {latestBreakdown.map((row) => {
              const total = series.at(-1)?.total ?? 0;
              return (
                <tr key={row.label} className="border-t">
                  <td className="px-4 py-2 font-medium">{row.label}</td>
                  <td
                    className={cn(
                      "px-4 py-2 text-right font-semibold tabular-nums",
                      row.value > 0 && "text-bull",
                      row.value < 0 && "text-bear",
                    )}
                  >
                    {formatFlow(row.value, locale)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {total ? formatPercent(row.value / total, { multiplier: 100 }) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <a
        href={data?.sourceUrl ?? COINSHARES_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        Nguồn CoinShares <ExternalLink className="size-3" />
      </a>
    </section>
  );
}
