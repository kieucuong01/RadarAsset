"use client";

import { ExternalLink } from "lucide-react";

import { CryptoCyclePanel } from "@/components/smart-insights/CryptoCyclePanel";
import { CryptoDerivativesPressurePanel } from "@/components/smart-insights/CryptoDerivativesPressurePanel";
import { CryptoEtfFlowPanel } from "@/components/smart-insights/CryptoEtfFlowPanel";
import {
  CryptoFearGreedPanel,
  type CryptoPanelMode,
} from "@/components/smart-insights/CryptoFearGreedPanel";
import { CryptoFundFlowPanel } from "@/components/smart-insights/CryptoFundFlowPanel";
import { CryptoLargeAddressPanel } from "@/components/smart-insights/CryptoLargeAddressPanel";
import { CryptoMetricTrendPanel } from "@/components/smart-insights/CryptoMetricTrendPanel";
import { FreshnessBadge } from "@/components/smart-insights/FreshnessBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildCryptoOverviewObservations,
  DERIVATIVE_METRIC_CODES,
  ONCHAIN_METRIC_CODES,
} from "@/lib/crypto-quant-pulse";
import type { CryptoMarketPulseModel } from "@/lib/crypto-market-pulse-client";
import type { MetricModel, RegimeModel } from "@/lib/smart-insights-client";

export function CryptoQuantPulseTabs({
  pulse,
  metrics,
  regime,
  mode,
  locale,
}: {
  pulse: CryptoMarketPulseModel | null;
  metrics: MetricModel[];
  regime: RegimeModel | undefined;
  mode: CryptoPanelMode;
  locale: "vi" | "en";
}) {
  const fearMode: CryptoPanelMode =
    mode === "system" && pulse?.fearGreed.status === "unavailable" ? "unavailable" : mode;
  const etfMode: CryptoPanelMode =
    mode === "system" && pulse?.etfFlows.status === "unavailable" ? "unavailable" : mode;
  const fundMode: CryptoPanelMode =
    mode === "system" && pulse?.fundFlows.status === "unavailable" ? "sample" : mode;
  const whaleMode: CryptoPanelMode =
    mode === "system" &&
    (!pulse?.largeAddressActivity || pulse.largeAddressActivity.status === "unavailable")
      ? "sample"
      : mode;
  const observations = buildCryptoOverviewObservations(mode === "system" ? pulse : null);

  return (
    <Tabs defaultValue="overview" className="min-w-0">
      <div className="overflow-x-auto pb-1">
        <TabsList className="w-max min-w-full justify-start">
          <TabsTrigger value="overview">Tổng quan</TabsTrigger>
          <TabsTrigger value="flows">Dòng tiền</TabsTrigger>
          <TabsTrigger value="sentiment">Tâm lý &amp; Phái sinh</TabsTrigger>
          <TabsTrigger value="cycle">Chu kỳ</TabsTrigger>
          <TabsTrigger value="onchain">On-chain</TabsTrigger>
          <TabsTrigger value="whales">Cá voi BTC</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="mt-4 space-y-6">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Crypto Quant Overview</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Quan sát ưu tiên theo chu kỳ, phái sinh, tâm lý và dòng tiền.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">{regime?.label ?? "Unavailable"}</span>
              <FreshnessBadge state={regime?.freshness ?? "unavailable"} />
            </div>
          </div>
          {observations.length ? (
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {observations.map((observation) => (
                <article key={observation.code} className="rounded-xl border bg-background/50 p-4">
                  <p className="text-xs text-muted-foreground">{observation.label}</p>
                  <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
                    {observation.displayValue}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <time dateTime={observation.effectiveAt}>
                      {new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
                        day: "2-digit",
                        month: "2-digit",
                      }).format(new Date(observation.effectiveAt))}
                    </time>
                    <a
                      href={observation.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${observation.sourceCode}`}
                    >
                      <ExternalLink className="size-3.5 text-primary" />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">Unavailable</p>
          )}
        </section>
        <CryptoFearGreedPanel data={pulse?.fearGreed ?? null} mode={fearMode} locale={locale} />
        <CryptoEtfFlowPanel data={pulse?.etfFlows ?? null} mode={etfMode} locale={locale} />
      </TabsContent>

      <TabsContent value="flows" className="mt-4 space-y-6">
        <CryptoEtfFlowPanel data={pulse?.etfFlows ?? null} mode={etfMode} locale={locale} />
        <CryptoFundFlowPanel data={pulse?.fundFlows ?? null} mode={fundMode} locale={locale} />
      </TabsContent>

      <TabsContent value="sentiment" className="mt-4 space-y-6">
        <CryptoFearGreedPanel data={pulse?.fearGreed ?? null} mode={fearMode} locale={locale} />
        <CryptoDerivativesPressurePanel data={pulse} mode={mode} locale={locale} />
        <CryptoMetricTrendPanel
          title="Deribit & thị trường phái sinh"
          description="Volatility, funding và open interest; mỗi đơn vị được vẽ riêng."
          metrics={metrics}
          metricCodes={DERIVATIVE_METRIC_CODES}
          locale={locale}
        />
      </TabsContent>

      <TabsContent value="cycle" className="mt-4">
        <CryptoCyclePanel data={pulse?.cycleIndicators ?? null} mode={mode} locale={locale} />
      </TabsContent>

      <TabsContent value="onchain" className="mt-4">
        <CryptoMetricTrendPanel
          title="On-chain Quant Pulse"
          description="Hoạt động mạng, định giá và thanh khoản stablecoin theo từng nguồn."
          metrics={metrics}
          metricCodes={ONCHAIN_METRIC_CODES}
          locale={locale}
        />
      </TabsContent>

      <TabsContent value="whales" className="mt-4">
        <CryptoLargeAddressPanel
          data={pulse?.largeAddressActivity ?? null}
          mode={whaleMode}
          locale={locale}
        />
      </TabsContent>
    </Tabs>
  );
}
