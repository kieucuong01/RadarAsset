"use client";

import { Activity, ExternalLink, ShieldCheck } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import type { CryptoMarketPulseModel } from "@/lib/crypto-market-pulse-client";
import { cn } from "@/lib/utils";
import type { CryptoPanelMode } from "./CryptoFearGreedPanel";

type LargeAddressActivity = NonNullable<CryptoMarketPulseModel["largeAddressActivity"]>;

const MEMPOOL_URL = "https://mempool.space/";
const BITINFOCHARTS_URL = "https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html";
const SAMPLE_DATES = Array.from({ length: 30 }, (_, index) =>
  new Date(Date.UTC(2026, 6, 16 + index)).toISOString(),
);

const LARGE_ADDRESS_SAMPLE: LargeAddressActivity = {
  status: "system",
  sourceCodes: ["mempool-btc-large-addresses", "bitinfocharts-top-addresses"],
  effectiveAt: SAMPLE_DATES.at(-1) ?? null,
  universeObservedAt: SAMPLE_DATES.at(-1) ?? null,
  score: 38,
  state: "accumulation",
  confidence: 74,
  calibrationStatus: "calibrated",
  horizons: {
    oneDay: {
      netAccumulationBtc: 420,
      accumulationBreadth: 0.46,
      distributionBreadth: 0.22,
      accumulatingCount: 23,
      distributingCount: 11,
      unchangedCount: 16,
    },
    sevenDay: {
      netAccumulationBtc: 1860,
      accumulationBreadth: 0.54,
      distributionBreadth: 0.26,
      accumulatingCount: 27,
      distributingCount: 13,
      unchangedCount: 10,
    },
    thirtyDay: {
      netAccumulationBtc: 6240,
      accumulationBreadth: 0.58,
      distributionBreadth: 0.3,
      accumulatingCount: 29,
      distributingCount: 15,
      unchangedCount: 6,
    },
  },
  exchangeFlows: SAMPLE_DATES.map((effectiveAt, index) => {
    const toExchangeBtc = Math.round(450 + Math.sin(index / 2.7) * 260 + (index % 5) * 28);
    const fromExchangeBtc = Math.round(520 + Math.cos(index / 3.2) * 230 + (index % 4) * 24);
    return {
      effectiveAt,
      toExchangeBtc,
      fromExchangeBtc,
      pressureBtc: toExchangeBtc - fromExchangeBtc,
    };
  }),
  concentrationSeries: SAMPLE_DATES.map((effectiveAt, index) => ({
    effectiveAt,
    top10Ratio: 0.61 + Math.sin(index / 5) * 0.018,
  })),
  breadthSeries: SAMPLE_DATES.map((effectiveAt, index) => {
    const accumulationBreadth = 0.42 + Math.sin(index / 4) * 0.12;
    const distributionBreadth = 0.3 + Math.cos(index / 5) * 0.09;
    return {
      effectiveAt,
      netAccumulationBtc: Math.round((accumulationBreadth - distributionBreadth) * 4300),
      accumulationBreadth,
      distributionBreadth,
      accumulatingCount: Math.round(accumulationBreadth * 50),
      distributingCount: Math.round(distributionBreadth * 50),
      unchangedCount: Math.max(
        0,
        50 - Math.round(accumulationBreadth * 50) - Math.round(distributionBreadth * 50),
      ),
    };
  }),
  notableActivity: [
    {
      effectiveAt: SAMPLE_DATES.at(-1) ?? "",
      address: "bc1q…7k2m",
      valueBtc: 684,
      direction: "outgoing",
      counterparty: "unknown",
      txid: "sample-tx-01",
      sourceUrl: MEMPOOL_URL,
      explorerUrl: MEMPOOL_URL,
    },
    {
      effectiveAt: SAMPLE_DATES.at(-2) ?? "",
      address: "1FzW…p8Qx",
      valueBtc: 512,
      direction: "incoming",
      counterparty: "unknown",
      txid: "sample-tx-02",
      sourceUrl: MEMPOOL_URL,
      explorerUrl: MEMPOOL_URL,
    },
  ],
  entrantsExits: {
    entrantCount: 2,
    exitCount: 1,
    entrantBalanceBtc: 2840,
    exitBalanceBtc: 1180,
  },
  qualityFlags: [],
  sources: [
    {
      sourceCode: "mempool-btc-large-addresses",
      sourceUrl: MEMPOOL_URL,
      observedAt: SAMPLE_DATES.at(-1) ?? null,
    },
    {
      sourceCode: "bitinfocharts-top-addresses",
      sourceUrl: BITINFOCHARTS_URL,
      observedAt: SAMPLE_DATES.at(-1) ?? null,
    },
  ],
  methodologyVersion: "btc-large-address-action-v1",
};

function dateLabel(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function formatBtc(value: number | null, digits = 0) {
  return value === null
    ? "—"
    : `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", { maximumFractionDigits: digits })} BTC`;
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function stateLabel(state: LargeAddressActivity["state"], locale: "vi" | "en") {
  const labels = {
    accumulation: locale === "vi" ? "Tích lũy" : "Accumulation",
    neutral: locale === "vi" ? "Trung tính" : "Neutral",
    distribution: locale === "vi" ? "Phân phối" : "Distribution",
    calibrating: locale === "vi" ? "Đang hiệu chỉnh" : "Calibrating",
    unavailable: locale === "vi" ? "Chưa có dữ liệu" : "Unavailable",
  };
  return labels[state];
}

export function CryptoLargeAddressPanel({
  data,
  mode,
  locale,
}: {
  data: CryptoMarketPulseModel["largeAddressActivity"] | null;
  mode: CryptoPanelMode;
  locale: "vi" | "en";
}) {
  if (mode === "loading") {
    return <div className="h-[780px] animate-pulse rounded-2xl border bg-muted/30" />;
  }

  const isSample = mode === "sample";
  const visible = isSample ? LARGE_ADDRESS_SAMPLE : data;
  if (mode === "unavailable" || !visible) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Hành động ví lớn BTC</h3>
          <DataStatusBadge status="UNAVAILABLE" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Chưa có cohort địa chỉ lớn BTC và giao dịch đã xác nhận đạt kiểm định.
        </p>
      </section>
    );
  }

  const latestFlow = visible.exchangeFlows.at(-1);
  const latestHorizon = visible.horizons.oneDay;
  const status = isSample ? "SAMPLE" : visible.status === "unavailable" ? "UNAVAILABLE" : "SYSTEM";
  const horizonRows = [
    ["1D", visible.horizons.oneDay],
    ["7D", visible.horizons.sevenDay],
    ["30D", visible.horizons.thirtyDay],
  ] as const;

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <h3 className="font-semibold">Hành động ví lớn BTC</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Cohort ≥1.000 BTC, loại trừ nhãn sàn đã kiểm duyệt · giao dịch ≥6 xác nhận
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DataStatusBadge status={status} />
          {isSample ? <span className="text-xs text-chart-4">Dữ liệu mẫu</span> : null}
          {!isSample && visible.status === "partial" ? (
            <span className="text-xs text-chart-4">Dữ liệu một phần</span>
          ) : null}
        </div>
      </div>

      {isSample ? (
        <p className="mt-3 rounded-lg border border-chart-4/30 bg-chart-4/10 px-3 py-2 text-xs text-chart-4">
          Dữ liệu mẫu — nguồn live vẫn đang tắt cho đến khi vượt qua live-smoke và kiểm định cohort.
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label={locale === "vi" ? "Điểm hành động" : "Action score"}
          value={visible.score === null ? "—" : visible.score.toFixed(1)}
          note={stateLabel(visible.state, locale)}
          tone={
            visible.score === null
              ? "neutral"
              : visible.score > 10
                ? "bull"
                : visible.score < -10
                  ? "bear"
                  : "neutral"
          }
        />
        <SummaryCard
          label={locale === "vi" ? "Tích lũy ròng 1D" : "1D net accumulation"}
          value={formatBtc(latestHorizon.netAccumulationBtc)}
          note={`${latestHorizon.accumulatingCount ?? "—"} ví tăng · ${latestHorizon.distributingCount ?? "—"} ví giảm`}
          tone={(latestHorizon.netAccumulationBtc ?? 0) > 0 ? "bull" : "bear"}
        />
        <SummaryCard
          label={locale === "vi" ? "Áp lực lên sàn" : "Exchange pressure"}
          value={formatBtc(latestFlow?.pressureBtc ?? null)}
          note={locale === "vi" ? "Nạp sàn − rút sàn" : "To exchange − from exchange"}
          tone={(latestFlow?.pressureBtc ?? 0) > 0 ? "bear" : "bull"}
        />
        <SummaryCard
          label={locale === "vi" ? "Độ tin cậy" : "Confidence"}
          value={visible.confidence === null ? "—" : `${visible.confidence.toFixed(0)}%`}
          note={
            visible.calibrationStatus === "calibrated"
              ? "btc-large-address-action-v1"
              : "Calibrating"
          }
          tone="neutral"
        />
      </div>

      <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
        <div className="min-w-0 rounded-xl border bg-background/30 p-4">
          <h4 className="text-sm font-semibold">Áp lực lên sàn</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Nạp/rút khỏi địa chỉ sàn đã được kiểm duyệt
          </p>
          <div className="mt-3 h-[300px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={visible.exchangeFlows}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.24} />
                <XAxis
                  dataKey="effectiveAt"
                  tickFormatter={(value: string) => dateLabel(value, locale)}
                  fontSize={11}
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={(value: number) => `${Math.round(value)} BTC`}
                  fontSize={11}
                  width={62}
                />
                <Tooltip
                  labelFormatter={(value) => dateLabel(String(value), locale)}
                  formatter={(value, name) => [formatBtc(Number(value)), String(name)]}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Bar dataKey="toExchangeBtc" name="Nạp sàn" fill="#ef4444" fillOpacity={0.62} />
                <Bar dataKey="fromExchangeBtc" name="Rút sàn" fill="#22c55e" fillOpacity={0.62} />
                <Line
                  type="monotone"
                  dataKey="pressureBtc"
                  name="Áp lực ròng"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.25}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="min-w-0 rounded-xl border bg-background/30 p-4">
          <h4 className="text-sm font-semibold">Độ rộng tích lũy</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Tỷ lệ ví tăng/giảm số dư trong common cohort
          </p>
          <div className="mt-3 h-[300px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={visible.breadthSeries}
                margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.24} />
                <XAxis
                  dataKey="effectiveAt"
                  tickFormatter={(value: string) => dateLabel(value, locale)}
                  fontSize={11}
                  minTickGap={24}
                />
                <YAxis
                  domain={[0, 1]}
                  tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
                  fontSize={11}
                />
                <Tooltip
                  labelFormatter={(value) => dateLabel(String(value), locale)}
                  formatter={(value, name) => [
                    `${(Number(value) * 100).toFixed(1)}%`,
                    String(name),
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="accumulationBreadth"
                  name="Tích lũy"
                  stroke="#22c55e"
                  strokeWidth={2.25}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="distributionBreadth"
                  name="Phân phối"
                  stroke="#ef4444"
                  strokeWidth={2.25}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-[560px] w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {["Kỳ", "Tích lũy ròng", "Độ rộng tích lũy", "Độ rộng phân phối"].map((header) => (
                  <th key={header} className="px-4 py-2 text-right first:text-left font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {horizonRows.map(([label, row]) => (
                <tr key={label} className="border-t">
                  <td className="px-4 py-2 font-semibold">{label}</td>
                  <td
                    className={cn(
                      "px-4 py-2 text-right font-semibold tabular-nums",
                      (row.netAccumulationBtc ?? 0) > 0 ? "text-bull" : "text-bear",
                    )}
                  >
                    {formatBtc(row.netAccumulationBtc)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatPercent(row.accumulationBreadth)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatPercent(row.distributionBreadth)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-[680px] w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {["Thời điểm", "Địa chỉ", "Hành động", "Khối lượng", "Đối tác", "Explorer"].map(
                  (header) => (
                    <th key={header} className="px-4 py-2 text-left font-medium">
                      {header}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {visible.notableActivity.length ? (
                visible.notableActivity.slice(0, 8).map((row) => (
                  <tr key={`${row.txid}:${row.address}`} className="border-t">
                    <td className="px-4 py-2 tabular-nums">{dateLabel(row.effectiveAt, locale)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{row.address}</td>
                    <td
                      className={cn(
                        "px-4 py-2 font-medium",
                        row.direction === "incoming" ? "text-bull" : "text-bear",
                      )}
                    >
                      {row.direction === "incoming" ? "Nhận" : "Gửi"}
                    </td>
                    <td className="px-4 py-2 font-semibold tabular-nums">
                      {formatBtc(row.valueBtc)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{row.counterparty}</td>
                    <td className="px-4 py-2">
                      <a
                        href={row.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open transaction ${row.txid}`}
                        className="text-primary"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="border-t">
                  <td colSpan={6} className="px-4 py-5 text-center text-muted-foreground">
                    Không có giao dịch nổi bật đạt ngưỡng.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-primary" />
          Chỉ phân loại dòng tiền tới/từ nhãn sàn đã được reviewed + verified.
        </span>
        <span className="flex flex-wrap gap-3">
          <a
            href={BITINFOCHARTS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Cohort BitInfoCharts <ExternalLink className="size-3" />
          </a>
          <a
            href={MEMPOOL_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Giao dịch Mempool <ExternalLink className="size-3" />
          </a>
        </span>
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "bull" | "bear" | "neutral";
}) {
  return (
    <article className="rounded-xl border bg-background/50 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 font-mono text-xl font-semibold tabular-nums",
          tone === "bull" && "text-bull",
          tone === "bear" && "text-bear",
        )}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground" title={note}>
        {note}
      </p>
    </article>
  );
}
