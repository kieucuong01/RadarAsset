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
import { FreshnessBadge } from "@/components/smart-insights/FreshnessBadge";
import type { CryptoMarketPulseModel } from "@/lib/crypto-market-pulse-client";
import { formatMetricValue, formatPercent } from "@/lib/financial-format";
import type { CryptoPanelMode } from "./CryptoFearGreedPanel";

const ALTCOIN_URL = "https://www.blockchaincenter.net/altcoin-season-index/";
const CBBI_URL = "https://colintalkscrypto.com/cbbi/";
const COMPONENT_LABELS: Record<string, string> = {
  pi_cycle: "Pi Cycle Top",
  rupl_nupl: "RUPL / NUPL",
  rhodl: "RHODL Ratio",
  puell: "Puell Multiple",
  two_year_ma: "2-Year MA Multiplier",
  trolololo: "Bitcoin Trolololo",
  mvrv: "MVRV Z-Score",
  reserve_risk: "Reserve Risk",
  woobull: "Woobull Top Cap vs CVDD",
};

function dateLabel(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(value));
}

function classificationLabel(value: string | null): string {
  if (value === "bitcoin_season") return "Bitcoin Season";
  if (value === "altcoin_season") return "Altcoin Season";
  return "Neutral";
}

function freshness(status: "system" | "partial" | "unavailable") {
  if (status === "partial") return "partial" as const;
  if (status === "system") return "fresh" as const;
  return "unavailable" as const;
}

export function CryptoCyclePanel({
  data,
  mode,
  locale,
}: {
  data: CryptoMarketPulseModel["cycleIndicators"] | null;
  mode: CryptoPanelMode;
  locale: "vi" | "en";
}) {
  if (mode === "loading") {
    return <div className="h-[620px] animate-pulse rounded-2xl border bg-muted/30" />;
  }

  const visible = mode === "system" ? data : null;
  const altcoin = visible?.altcoinSeason.latest ?? null;
  const cbbi = visible?.cbbi.latest ?? null;
  if (!altcoin && !cbbi) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Chỉ số chu kỳ BTC</h3>
          <DataStatusBadge status="UNAVAILABLE" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Unavailable — chưa có quan sát BlockchainCenter hoặc CBBI đạt kiểm định.
        </p>
      </section>
    );
  }

  return (
    <section className="min-w-0 space-y-6">
      {altcoin ? (
        <article className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Altcoin Season Index</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Ba cửa sổ độc lập; ngưỡng 25 và 75 áp dụng cho chỉ số 90 ngày.
              </p>
            </div>
            <FreshnessBadge state={freshness(visible!.altcoinSeason.status)} />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ["90 ngày", altcoin.season90d],
              ["1 tháng", altcoin.month],
              ["1 năm", altcoin.year],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border bg-background/50 p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
                  {formatMetricValue(typeof value === "number" ? value : null, {
                    locale,
                    unit: "INDEX",
                  })}
                </p>
              </div>
            ))}
          </div>

          {altcoin.season90d != null ? (
            <div className="mt-5">
              <div className="relative h-3 overflow-hidden rounded-full bg-gradient-to-r from-amber-500/70 via-slate-400/50 to-violet-500/70">
                <span className="absolute inset-y-0 left-1/4 w-px bg-background" />
                <span className="absolute inset-y-0 left-3/4 w-px bg-background" />
                <span
                  className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow"
                  style={{ left: `${altcoin.season90d}%` }}
                />
              </div>
              <div className="mt-2 grid grid-cols-3 text-[11px] text-muted-foreground">
                <span>Bitcoin Season · ≤25</span>
                <span className="text-center">Neutral · 26–74</span>
                <span className="text-right">Altcoin Season · ≥75</span>
              </div>
              <p className="mt-3 text-sm font-semibold">
                90D: {classificationLabel(altcoin.classification)}
              </p>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <time dateTime={altcoin.effectiveAt}>{dateLabel(altcoin.effectiveAt, locale)}</time>
            <a
              href={visible!.altcoinSeason.sourceUrl || ALTCOIN_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              BlockchainCenter <ExternalLink className="size-3" />
            </a>
          </div>
        </article>
      ) : null}

      {cbbi ? (
        <article className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">CBBI Confidence</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Confidence lịch sử và chín thành phần công khai mới nhất.
              </p>
            </div>
            <FreshnessBadge state={freshness(visible!.cbbi.status)} />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[180px_minmax(0,1fr)] lg:items-center">
            <div className="rounded-xl border bg-background/50 p-5 text-center">
              <p className="text-xs text-muted-foreground">Confidence</p>
              <p className="mt-2 font-mono text-4xl font-bold tabular-nums">
                {formatPercent(cbbi.confidence)}
              </p>
            </div>
            {visible!.cbbi.series.length > 1 ? (
              <div className="h-64 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={visible!.cbbi.series}
                    margin={{ top: 8, right: 12, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.24} />
                    <ReferenceArea y1={0} y2={25} fill="#f59e0b" fillOpacity={0.05} />
                    <ReferenceArea y1={75} y2={100} fill="#8b5cf6" fillOpacity={0.05} />
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
                      tickFormatter={(value: number) => formatPercent(value)}
                      fontSize={11}
                    />
                    <Tooltip
                      labelFormatter={(value) => dateLabel(String(value), locale)}
                      formatter={(value) => [
                        formatPercent(value == null ? null : Number(value)),
                        "CBBI Confidence",
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="confidence"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2.5}
                      dot={false}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cbbi.components.map((component) => (
              <div key={component.code} className="rounded-xl border bg-background/50 p-4">
                <p className="text-xs text-muted-foreground">
                  {COMPONENT_LABELS[component.code] ?? component.code}
                </p>
                <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
                  {formatPercent(component.value)}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <time dateTime={cbbi.effectiveAt}>{dateLabel(cbbi.effectiveAt, locale)}</time>
            <a
              href={visible!.cbbi.sourceUrl || CBBI_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Colin Talks Crypto · CBBI <ExternalLink className="size-3" />
            </a>
          </div>
        </article>
      ) : null}

      <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
        Không phải mức giá mục tiêu hoặc khuyến nghị giao dịch. Các chỉ số chỉ mô tả trạng thái chu
        kỳ theo phương pháp của từng nguồn.
      </p>
    </section>
  );
}
