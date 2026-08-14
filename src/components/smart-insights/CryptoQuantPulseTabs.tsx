"use client";

import { useMemo } from "react";
import { ExternalLink } from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CryptoMarketPulseModel } from "@/lib/crypto-market-pulse-client";
import {
  buildCryptoMetricSeries,
  buildCryptoOverviewObservations,
  DERIVATIVE_METRIC_CODES,
  ONCHAIN_METRIC_CODES,
} from "@/lib/crypto-quant-pulse";
import type { MetricModel, RegimeModel } from "@/lib/smart-insights-client";
import type { KronosShadowModel } from "@/lib/smart-insights-client";
import { CryptoEtfFlowPanel } from "./CryptoEtfFlowPanel";
import { CryptoFearGreedPanel, type CryptoPanelMode } from "./CryptoFearGreedPanel";
import { CryptoFundFlowPanel } from "./CryptoFundFlowPanel";
import { CryptoLargeAddressPanel } from "./CryptoLargeAddressPanel";
import { CryptoMetricTrendPanel } from "./CryptoMetricTrendPanel";
import { FreshnessBadge } from "./FreshnessBadge";
import { KronosShadowPanel } from "./KronosShadowPanel";

type CryptoPulseState = "idle" | "loading" | "loaded" | "failed";

function dateLabel(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatValue(value: number, unit: string, locale: "vi" | "en") {
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

function CryptoOverviewSummary({
  cryptoPulse,
  metrics,
  regime,
  locale,
}: {
  cryptoPulse: CryptoMarketPulseModel | null;
  metrics: MetricModel[];
  regime: RegimeModel | undefined;
  locale: "vi" | "en";
}) {
  const observations = buildCryptoOverviewObservations(cryptoPulse, metrics);

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Crypto Quant Pulse</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {locale === "vi"
              ? "Ảnh chụp định lượng theo nguồn và thời điểm hiệu lực."
              : "A sourced quantitative snapshot by effective time."}
          </p>
        </div>
        <FreshnessBadge state={regime?.freshness ?? "unavailable"} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border bg-background/50 p-4">
          <p className="text-xs text-muted-foreground">Regime</p>
          <p className="mt-2 text-lg font-semibold">{regime?.label ?? "Unavailable"}</p>
          {regime?.effectiveAt ? (
            <time
              dateTime={regime.effectiveAt}
              className="mt-1 block text-[11px] text-muted-foreground"
            >
              {dateLabel(regime.effectiveAt, locale)}
            </time>
          ) : null}
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Confidence</dt>
              <dd className="mt-1 font-mono font-semibold">{regime?.dataConfidence ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Coverage</dt>
              <dd className="mt-1 font-mono font-semibold">{regime?.coverage ?? "—"}</dd>
            </div>
          </dl>
        </article>

        {observations.map((item) => (
          <article key={item.kind} className="rounded-xl border bg-background/50 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <FreshnessBadge state={item.freshness} />
            </div>
            <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
              {formatValue(item.value, item.unit, locale)}{" "}
              <span className="text-xs font-normal text-muted-foreground">{item.unit}</span>
            </p>
            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <time dateTime={item.effectiveAt}>{dateLabel(item.effectiveAt, locale)}</time>
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
                title={item.sourceCode}
              >
                <span className="truncate">{item.sourceCode}</span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
            </div>
          </article>
        ))}

        {!regime && !observations.length ? (
          <div className="sm:col-span-2 xl:col-span-4">
            <DataStatusBadge status="UNAVAILABLE" />
            <p className="mt-2 text-sm text-muted-foreground">
              {locale === "vi"
                ? "Chưa có quan sát Crypto đạt kiểm định."
                : "No validated Crypto observations are available."}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function CryptoQuantPulseTabs({
  cryptoPulse,
  cryptoPulseState,
  metrics,
  regime,
  locale,
  kronosShadow,
  kronosShadowState,
}: {
  cryptoPulse: CryptoMarketPulseModel | null;
  cryptoPulseState: CryptoPulseState;
  metrics: MetricModel[];
  regime: RegimeModel | undefined;
  locale: "vi" | "en";
  kronosShadow: KronosShadowModel | null;
  kronosShadowState: CryptoPulseState;
}) {
  const derivativeSeries = useMemo(
    () => buildCryptoMetricSeries(metrics, DERIVATIVE_METRIC_CODES),
    [metrics],
  );
  const onchainSeries = useMemo(
    () => buildCryptoMetricSeries(metrics, ONCHAIN_METRIC_CODES),
    [metrics],
  );
  const requestMode: CryptoPanelMode =
    cryptoPulseState === "failed" ? "sample" : cryptoPulseState !== "loaded" ? "loading" : "system";
  const fearMode: CryptoPanelMode =
    requestMode === "system" && cryptoPulse?.fearGreed.status === "unavailable"
      ? "unavailable"
      : requestMode;
  const etfMode: CryptoPanelMode =
    requestMode === "system" && cryptoPulse?.etfFlows.status === "unavailable"
      ? "unavailable"
      : requestMode;
  const fundMode: CryptoPanelMode =
    requestMode === "system" && cryptoPulse?.fundFlows.status === "unavailable"
      ? "sample"
      : requestMode;
  const largeAddressMode: CryptoPanelMode =
    requestMode === "system" &&
    (!cryptoPulse?.largeAddressActivity ||
      cryptoPulse.largeAddressActivity.status === "unavailable")
      ? "sample"
      : requestMode;

  return (
    <Tabs defaultValue="overview" className="min-w-0">
      <div className="overflow-x-auto pb-1">
        <TabsList className="h-auto min-w-max justify-start">
          <TabsTrigger value="overview">Tổng quan</TabsTrigger>
          <TabsTrigger value="flows">Dòng tiền</TabsTrigger>
          <TabsTrigger value="sentiment">Tâm lý &amp; Phái sinh</TabsTrigger>
          <TabsTrigger value="onchain">On-chain</TabsTrigger>
          <TabsTrigger value="whales">Cá voi BTC</TabsTrigger>
          <TabsTrigger value="forecast">BTC Forecast</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="mt-4 min-w-0 space-y-6">
        <CryptoOverviewSummary
          cryptoPulse={cryptoPulse}
          metrics={metrics}
          regime={regime}
          locale={locale}
        />
        <div className="grid min-w-0 gap-6 xl:grid-cols-2">
          <CryptoFearGreedPanel
            data={cryptoPulse?.fearGreed ?? null}
            mode={fearMode}
            locale={locale}
          />
          <CryptoEtfFlowPanel data={cryptoPulse?.etfFlows ?? null} mode={etfMode} locale={locale} />
        </div>
      </TabsContent>

      <TabsContent value="flows" className="mt-4 min-w-0 space-y-6">
        <CryptoEtfFlowPanel data={cryptoPulse?.etfFlows ?? null} mode={etfMode} locale={locale} />
        <CryptoFundFlowPanel
          data={cryptoPulse?.fundFlows ?? null}
          mode={fundMode}
          locale={locale}
        />
      </TabsContent>

      <TabsContent value="sentiment" className="mt-4 min-w-0 space-y-6">
        <CryptoFearGreedPanel
          data={cryptoPulse?.fearGreed ?? null}
          mode={fearMode}
          locale={locale}
        />
        <CryptoMetricTrendPanel
          title="Phái sinh Crypto"
          description="Funding, open interest và implied volatility theo chuỗi thời gian đã kiểm định."
          series={derivativeSeries}
          emptyDescription="Chưa đủ ít nhất hai quan sát hợp lệ để hiển thị xu hướng phái sinh."
          locale={locale}
        />
      </TabsContent>

      <TabsContent value="onchain" className="mt-4 min-w-0">
        <CryptoMetricTrendPanel
          title="On-chain"
          description="Hoạt động mạng, định giá và thanh khoản stablecoin, tách theo đơn vị đo."
          series={onchainSeries}
          emptyDescription="Chưa có chuỗi on-chain đạt kiểm định; hệ thống không tạo dữ liệu thay thế."
          locale={locale}
        />
      </TabsContent>

      <TabsContent value="whales" className="mt-4 min-w-0">
        <CryptoLargeAddressPanel
          data={cryptoPulse?.largeAddressActivity ?? null}
          mode={largeAddressMode}
          locale={locale}
        />
      </TabsContent>

      <TabsContent value="forecast" className="mt-4 min-w-0">
        <KronosShadowPanel data={kronosShadow} state={kronosShadowState} locale={locale} />
      </TabsContent>
    </Tabs>
  );
}
