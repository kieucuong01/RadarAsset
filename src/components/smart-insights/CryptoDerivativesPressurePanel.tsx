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
import { FreshnessBadge } from "@/components/smart-insights/FreshnessBadge";
import type { CryptoMarketPulseModel } from "@/lib/crypto-market-pulse-client";
import { formatPercent, formatPrice } from "@/lib/financial-format";
import type { CryptoPanelMode } from "./CryptoFearGreedPanel";

const MARGIN_URL = "https://www.coinglass.com/pro/i/MarginFeeChart";
const MAX_PAIN_URL = "https://www.coinglass.com/liquidation-maxpain";
const ASSET_ORDER = ["BTC", "ETH", "SOL"];

function dateLabel(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
  }).format(new Date(value));
}

function rate(value: number | null): string {
  return formatPercent(value);
}

function usd(value: number | null): string {
  return formatPrice(value, { locale: "en", currency: "USD" });
}

function distance(value: number): string {
  return formatPercent(value, { multiplier: 100, sign: true });
}

export function CryptoDerivativesPressurePanel({
  data,
  mode,
  locale,
}: {
  data: Pick<CryptoMarketPulseModel, "marginBorrow" | "liquidationMaxPain"> | null;
  mode: CryptoPanelMode;
  locale: "vi" | "en";
}) {
  if (mode === "loading") {
    return <div className="h-[540px] animate-pulse rounded-2xl border bg-muted/30" />;
  }

  const margin = mode === "system" ? data?.marginBorrow : null;
  const maxPain = mode === "system" ? data?.liquidationMaxPain : null;
  const latestMargin = margin?.series.at(-1) ?? null;
  const rows = [...(maxPain?.rows ?? [])].sort(
    (left, right) => ASSET_ORDER.indexOf(left.asset) - ASSET_ORDER.indexOf(right.asset),
  );
  const available = Boolean(latestMargin || rows.length);

  if (!available) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Áp lực phái sinh · CoinGlass</h3>
          <DataStatusBadge status="UNAVAILABLE" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Unavailable — chưa có bảng công khai CoinGlass đạt kiểm định.
        </p>
      </section>
    );
  }

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Áp lực phái sinh · CoinGlass</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Lãi vay margin Binance USDT và Liquidation Max Pain 24h.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DataStatusBadge status="SYSTEM" />
          {margin?.status === "partial" || maxPain?.status === "partial" ? (
            <span className="text-xs text-chart-4">Dữ liệu một phần</span>
          ) : null}
        </div>
      </div>

      {latestMargin ? (
        <div className="mt-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Annualized", latestMargin.annualizedRate],
              ["Daily", latestMargin.dailyRate],
              ["Hourly", latestMargin.hourlyRate],
            ].map(([label, value]) => (
              <article key={String(label)} className="rounded-xl border bg-background/50 p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
                  {rate(typeof value === "number" ? value : null)}
                </p>
              </article>
            ))}
          </div>

          {margin!.series.length > 1 ? (
            <div className="mt-4 h-64 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={margin!.series}
                  margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
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
                  <YAxis unit="%" fontSize={11} width={58} />
                  <Tooltip
                    labelFormatter={(value) => dateLabel(String(value), locale)}
                    formatter={(value) => [
                      rate(value == null ? null : Number(value)),
                      "Annualized",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="annualizedRate"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <FreshnessBadge state={margin!.status === "partial" ? "partial" : "fresh"} />
            <a
              href={margin!.sourceUrl || MARGIN_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              CoinGlass Margin Fee Chart <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      ) : null}

      {rows.length ? (
        <div className="mt-6 overflow-x-auto rounded-xl border">
          <table className="min-w-[920px] w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {[
                  "Asset",
                  "Current",
                  "Long price",
                  "Long distance",
                  "Long level",
                  "Short price",
                  "Short distance",
                  "Short level",
                  "Effective",
                ].map((header) => (
                  <th key={header} className="px-3 py-2 text-right first:text-left font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.asset} className="border-t">
                  <td className="px-3 py-2 font-semibold">{row.asset}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(row.currentPriceUsd)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {usd(row.long?.priceUsd ?? null)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.long ? distance(row.long.distanceRatio) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {usd(row.long?.levelUsd ?? null)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {usd(row.short?.priceUsd ?? null)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.short ? distance(row.short.distanceRatio) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {usd(row.short?.levelUsd ?? null)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {dateLabel(row.effectiveAt, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {rows.length ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <FreshnessBadge state={maxPain!.status === "partial" ? "partial" : "fresh"} />
          <a
            href={maxPain!.sourceUrl || MAX_PAIN_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            CoinGlass Liquidation Max Pain <ExternalLink className="size-3" />
          </a>
        </div>
      ) : null}
    </section>
  );
}
