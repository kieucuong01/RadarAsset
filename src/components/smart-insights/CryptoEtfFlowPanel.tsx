"use client";

import { useState } from "react";
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
import { formatMetricValue, formatNumber } from "@/lib/financial-format";
import { cn } from "@/lib/utils";
import type { CryptoPanelMode } from "./CryptoFearGreedPanel";

const FARSIDE_URL = "https://farside.co.uk";
const ASSETS = [
  { key: "btc", label: "BTC", color: "#f59e0b" },
  { key: "eth", label: "ETH", color: "#6366f1" },
  { key: "sol", label: "SOL", color: "#14b8a6" },
] as const;
type AssetKey = (typeof ASSETS)[number]["key"];

const ETF_SAMPLE: CryptoMarketPulseModel["etfFlows"] = {
  status: "system",
  sourceCodes: ["farside-btc-etf", "farside-eth-etf", "farside-sol-etf"],
  series: Array.from({ length: 30 }, (_, index) => {
    const btc = Math.round((Math.sin(index / 3) * 180 + 45) * 1_000_000);
    const eth = index % 5 === 0 ? null : Math.round((Math.cos(index / 4) * 65 + 10) * 1_000_000);
    const sol = Math.round((Math.sin(index / 2) * 20 + 3) * 1_000_000);
    return {
      effectiveAt: new Date(Date.UTC(2026, 6, 16 + index)).toISOString(),
      btc,
      eth,
      sol,
      total: btc + (eth ?? 0) + sol,
    };
  }),
  summaries: [],
};

function dateLabel(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function formatFlow(value: number | null, locale: "vi" | "en"): string {
  return formatMetricValue(value === null ? null : value / 1_000_000, {
    locale,
    unit: "USD_MILLION",
  });
}

function summarize(data: CryptoMarketPulseModel["etfFlows"], key: AssetKey) {
  const reported = data.series
    .filter((row) => row[key] !== null)
    .map((row) => ({ effectiveAt: row.effectiveAt, value: row[key] as number }));
  const sum = (rows: typeof reported) =>
    rows.length ? rows.reduce((total, row) => total + row.value, 0) : null;
  return {
    latest: reported.at(-1)?.value ?? null,
    fiveDay: sum(reported.slice(-5)),
    thirtyDay: sum(reported),
  };
}

export function CryptoEtfFlowPanel({
  data,
  mode,
  locale,
}: {
  data: CryptoMarketPulseModel["etfFlows"] | null;
  mode: CryptoPanelMode;
  locale: "vi" | "en";
}) {
  const [visibleAssets, setVisibleAssets] = useState<Set<AssetKey>>(
    () => new Set(ASSETS.map((asset) => asset.key)),
  );

  if (mode === "loading") {
    return <div className="h-[520px] animate-pulse rounded-2xl border bg-muted/30" />;
  }

  const visible = mode === "sample" ? ETF_SAMPLE : data;
  if (mode === "unavailable" || !visible?.series.length) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">ETF Flow · BTC, ETH, SOL</h3>
          <DataStatusBadge status="UNAVAILABLE" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Chưa có dòng tổng Farside đạt kiểm định trong cửa sổ 30 ngày.
        </p>
      </section>
    );
  }

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">ETF Flow · BTC, ETH, SOL</h3>
          <p className="mt-1 text-xs text-muted-foreground">Dòng tiền ETF hằng ngày · Farside</p>
        </div>
        <div className="flex items-center gap-2">
          <DataStatusBadge status={mode === "sample" ? "SAMPLE" : "SYSTEM"} />
          {mode === "sample" ? <span className="text-xs text-chart-4">Dữ liệu mẫu</span> : null}
          {mode === "system" && visible.status === "partial" ? (
            <span className="text-xs text-chart-4">Dữ liệu một phần</span>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {ASSETS.map((asset) => {
          const summary =
            visible.summaries.find((row) => row.asset === asset.label) ??
            summarize(visible, asset.key);
          return (
            <article key={asset.key} className="rounded-xl border bg-background/50 p-4">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: asset.color }} />
                <span className="font-semibold">{asset.label}</span>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                {[
                  ["Mới nhất", summary.latest],
                  ["5D", summary.fiveDay],
                  ["30D", summary.thirtyDay],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd
                      className={cn(
                        "mt-1 font-semibold tabular-nums",
                        typeof value === "number" && value > 0 && "text-bull",
                        typeof value === "number" && value < 0 && "text-bear",
                      )}
                    >
                      {formatFlow(typeof value === "number" ? value : null, locale)}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap gap-2" aria-label="ETF chart legend">
        {ASSETS.map((asset) => {
          const active = visibleAssets.has(asset.key);
          return (
            <button
              key={asset.key}
              type="button"
              aria-pressed={active}
              onClick={() =>
                setVisibleAssets((current) => {
                  const next = new Set(current);
                  if (next.has(asset.key)) next.delete(asset.key);
                  else next.add(asset.key);
                  return next;
                })
              }
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-xs font-semibold",
                !active && "opacity-40",
              )}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: asset.color }} />
              {asset.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 h-[320px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={visible.series}
            barGap={2}
            margin={{ top: 12, right: 12, left: 4, bottom: 0 }}
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
              tickFormatter={(value: number) =>
                formatNumber(value / 1_000_000, { maximumFractionDigits: 2 })
              }
              fontSize={11}
              width={52}
            />
            <Tooltip
              labelFormatter={(value) => dateLabel(String(value), locale)}
              formatter={(value) => formatFlow(value == null ? null : Number(value), locale)}
            />
            <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1.5} />
            {ASSETS.map((asset) =>
              visibleAssets.has(asset.key) ? (
                <Bar key={asset.key} dataKey={asset.key} fill={asset.color} radius={[2, 2, 0, 0]} />
              ) : null,
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {["Date", "BTC", "ETH", "SOL", "Total"].map((header) => (
                <th key={header} className="px-4 py-2 text-right first:text-left font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...visible.series].reverse().map((row) => (
              <tr key={row.effectiveAt} className="border-t">
                <td className="px-4 py-2 tabular-nums">{dateLabel(row.effectiveAt, locale)}</td>
                {[row.btc, row.eth, row.sol, row.total].map((value, index) => (
                  <td
                    key={index}
                    className={cn(
                      "px-4 py-2 text-right font-medium tabular-nums",
                      value !== null && value > 0 && "text-bull",
                      value !== null && value < 0 && "text-bear",
                    )}
                  >
                    {formatFlow(value, locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <a
        href={FARSIDE_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        Nguồn Farside <ExternalLink className="size-3" />
      </a>
    </section>
  );
}
