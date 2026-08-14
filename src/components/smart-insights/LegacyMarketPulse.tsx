"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ExternalLink } from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { CryptoEtfFlowPanel } from "@/components/smart-insights/CryptoEtfFlowPanel";
import {
  CryptoFearGreedPanel,
  type CryptoPanelMode,
} from "@/components/smart-insights/CryptoFearGreedPanel";
import { CryptoFundFlowPanel } from "@/components/smart-insights/CryptoFundFlowPanel";
import { FreshnessBadge } from "@/components/smart-insights/FreshnessBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { InsightMarket } from "@/lib/backend/smart-insights-types";
import type { MarketTickerResponse } from "@/lib/backend/types";
import {
  fetchCryptoMarketPulse,
  type CryptoMarketPulseModel,
} from "@/lib/crypto-market-pulse-client";
import { useI18n } from "@/lib/i18n/context";
import type { MetricModel, RegimeModel } from "@/lib/smart-insights-client";

const SAMPLE_TICKERS = [
  { symbol: "BTC", price: 100, changePercent: 1.2 },
  { symbol: "ETH", price: 100, changePercent: -0.4 },
  { symbol: "GOLD", price: 100, changePercent: 0.3 },
  { symbol: "DXY", price: 100, changePercent: -0.2 },
];

const SAMPLE_MARKET_METRICS = {
  crypto: ["ETF Flow", "On-chain Activity", "Stablecoin Liquidity"],
  macro: ["Real Yield", "USD Liquidity", "Inflation Trend"],
  gold: ["XAU Momentum", "CFTC Positioning", "Central-bank Demand"],
};

export function LegacyMarketPulse({
  market,
  metrics,
  regimes,
  onMarketChange,
}: {
  market: InsightMarket;
  metrics: MetricModel[];
  regimes: RegimeModel[];
  onMarketChange: (market: InsightMarket) => void;
}) {
  const { locale, t } = useI18n();
  const [tickers, setTickers] =
    useState<Array<Pick<MarketTickerResponse, "symbol" | "price" | "changePercent">>>(
      SAMPLE_TICKERS,
    );
  const [tickerStatus, setTickerStatus] = useState<"SYSTEM" | "SAMPLE">("SAMPLE");
  const [cryptoPulse, setCryptoPulse] = useState<CryptoMarketPulseModel | null>(null);
  const [cryptoPulseState, setCryptoPulseState] = useState<
    "idle" | "loading" | "loaded" | "failed"
  >("idle");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/market/ticker", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then((response) => {
        if (!response.ok) throw new Error("Ticker API unavailable");
        return response.json() as Promise<MarketTickerResponse[]>;
      })
      .then((rows) => {
        if (!controller.signal.aborted && rows.length) {
          setTickers(rows.slice(0, 8));
          setTickerStatus("SYSTEM");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setTickers(SAMPLE_TICKERS);
          setTickerStatus("SAMPLE");
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (market !== "crypto") return;
    const controller = new AbortController();
    setCryptoPulse(null);
    setCryptoPulseState("loading");
    fetchCryptoMarketPulse(controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) {
          setCryptoPulse(payload);
          setCryptoPulseState("loaded");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setCryptoPulseState("failed");
      });
    return () => controller.abort();
  }, [market]);

  const marketMetrics = useMemo(
    () => metrics.filter((metric) => metric.market === market),
    [market, metrics],
  );
  const cryptoMetrics = useMemo(
    () => metrics.filter((metric) => metric.market === "crypto"),
    [metrics],
  );
  const onchain = cryptoMetrics
    .filter((metric) => /onchain|stablecoin|etf/.test(metric.metricCode))
    .slice(0, 4);
  const selectedRegime = regimes.find((regime) => regime.market === market);
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

  return (
    <section className="space-y-6" aria-labelledby="market-pulse-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="market-pulse-heading" className="text-2xl font-bold tracking-tight">
            Market Pulse
          </h2>
          <p className="text-sm text-muted-foreground">
            {locale === "vi"
              ? "Dữ liệu định lượng theo từng thị trường."
              : "Quantitative data by market."}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs">
          <span className="uppercase text-muted-foreground">Regime</span>
          <strong>{selectedRegime?.label ?? "Unavailable"}</strong>
          <FreshnessBadge state={selectedRegime?.freshness ?? "unavailable"} />
        </div>
      </div>

      <Tabs value={market} onValueChange={(value) => onMarketChange(value as InsightMarket)}>
        <TabsList className="grid w-full grid-cols-3 sm:w-fit">
          <TabsTrigger value="crypto">Crypto</TabsTrigger>
          <TabsTrigger value="macro">Macro</TabsTrigger>
          <TabsTrigger value="gold">Gold</TabsTrigger>
        </TabsList>
        <TabsContent value="crypto" className="mt-4">
          <div className="min-w-0 space-y-6">
            <CryptoFearGreedPanel
              data={cryptoPulse?.fearGreed ?? null}
              mode={fearMode}
              locale={locale}
            />
            <CryptoEtfFlowPanel
              data={cryptoPulse?.etfFlows ?? null}
              mode={etfMode}
              locale={locale}
            />
            <CryptoFundFlowPanel
              data={cryptoPulse?.fundFlows ?? null}
              mode={fundMode}
              locale={locale}
            />
            <div className="grid min-w-0 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="min-w-0 space-y-2.5 rounded-2xl border border-border bg-card p-6">
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Activity className="size-3" /> {t("overview.market.onChainPulse")}
                  {!onchain.length ? <DataStatusBadge status="SAMPLE" /> : null}
                </div>
                {(onchain.length ? onchain : null)?.map((metric) => (
                  <div
                    key={metric.observationId}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="truncate text-muted-foreground" title={metric.metricCode}>
                      {metric.metricCode.replace("crypto.", "")}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {metric.value} {metric.unit}
                    </span>
                  </div>
                )) ??
                  SAMPLE_MARKET_METRICS.crypto.slice(0, 3).map((label, index) => (
                    <div key={label} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-semibold tabular-nums">{[50, 100, 0][index]}</span>
                    </div>
                  ))}
              </div>
              <MetricGrid market="crypto" metrics={marketMetrics} locale={locale} />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="macro" className="mt-4">
          <MetricGrid market="macro" metrics={marketMetrics} locale={locale} />
        </TabsContent>
        <TabsContent value="gold" className="mt-4">
          <MetricGrid market="gold" metrics={marketMetrics} locale={locale} />
        </TabsContent>
      </Tabs>

      <div className="min-w-0 rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="font-semibold">{t("overview.market.trendingAssets")}</h3>
          <DataStatusBadge status={tickerStatus} />
        </div>
        <div className="flex gap-3 overflow-x-auto px-1 pb-2">
          {tickers.map((ticker) => (
            <div
              key={ticker.symbol}
              className="min-w-[140px] shrink-0 rounded-xl border border-border bg-background/50 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm">{ticker.symbol}</span>
                <span
                  className={
                    ticker.changePercent >= 0
                      ? "text-xs font-semibold text-bull"
                      : "text-xs font-semibold text-bear"
                  }
                >
                  {ticker.changePercent >= 0 ? "+" : ""}
                  {ticker.changePercent.toFixed(2)}%
                </span>
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {ticker.price.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MetricGrid({
  market,
  metrics,
  locale,
}: {
  market: InsightMarket;
  metrics: MetricModel[];
  locale: "vi" | "en";
}) {
  const latest = new Map<string, MetricModel>();
  for (const metric of metrics) {
    const key = `${metric.metricCode}:${metric.asset ?? "global"}`;
    if (!latest.has(key)) latest.set(key, metric);
  }
  const rows = [...latest.values()];
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold capitalize">{market} Quant Pulse</h3>
          <p className="text-xs text-muted-foreground">
            {locale === "vi"
              ? "Quan sát point-in-time mới nhất."
              : "Latest point-in-time observations."}
          </p>
        </div>
        {!rows.length ? <DataStatusBadge status="SAMPLE" /> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.length
          ? rows.map((metric) => (
              <article
                key={metric.observationId}
                className="flex min-w-0 flex-col gap-2 rounded-xl border bg-background/50 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-xs text-muted-foreground" title={metric.metricCode}>
                    {metric.metricCode}
                  </p>
                  <FreshnessBadge state={metric.freshness} />
                </div>
                <p className="font-mono text-xl font-semibold">
                  {metric.value}{" "}
                  <span className="text-xs font-normal text-muted-foreground">{metric.unit}</span>
                </p>
                <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {metric.asset ?? "Global"} · {metric.sourceCode}
                  </span>
                  <a
                    href={metric.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${metric.sourceCode}`}
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>
              </article>
            ))
          : SAMPLE_MARKET_METRICS[market].map((label, index) => (
              <article key={label} className="rounded-xl border bg-background/50 p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 font-mono text-xl font-semibold">{[50, 0, 100][index]}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {locale === "vi" ? "Dữ liệu minh họa" : "Illustrative data"}
                </p>
              </article>
            ))}
      </div>
    </div>
  );
}
