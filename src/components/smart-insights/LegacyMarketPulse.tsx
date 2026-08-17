"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { CryptoQuantPulseTabs } from "@/components/smart-insights/CryptoQuantPulseTabs";
import { FreshnessBadge } from "@/components/smart-insights/FreshnessBadge";
import { formatMarketMetric } from "@/components/smart-insights/market-metric-value";
import {
  MacroQuantPulseTabs,
  type MacroPulseState,
} from "@/components/smart-insights/MacroQuantPulseTabs";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { InsightMarket } from "@/lib/backend/smart-insights-types";
import {
  fetchCryptoMarketPulse,
  type CryptoMarketPulseModel,
} from "@/lib/crypto-market-pulse-client";
import { useI18n } from "@/lib/i18n/context";
import type {
  EnergyPulseModel,
  KronosShadowModel,
  MacroEventRiskModel,
  MetricModel,
  RegimeModel,
} from "@/lib/smart-insights-client";
import { fetchParsed, kronosShadowSchema } from "@/lib/smart-insights-client";

const SAMPLE_MARKET_METRICS = {
  crypto: ["ETF Flow", "On-chain Activity", "Stablecoin Liquidity"],
  macro: ["Real Yield", "USD Liquidity", "Inflation Trend"],
  gold: ["XAU Momentum", "CFTC Positioning", "Central-bank Demand"],
};

export function LegacyMarketPulse({
  authenticated = true,
  market,
  metrics,
  regimes,
  macroEventRisk,
  energyPulse,
  macroPulseState,
  onMarketChange,
}: {
  authenticated?: boolean;
  market: InsightMarket;
  metrics: MetricModel[];
  regimes: RegimeModel[];
  macroEventRisk: MacroEventRiskModel | null;
  energyPulse: EnergyPulseModel | null;
  macroPulseState: MacroPulseState;
  onMarketChange: (market: InsightMarket) => void;
}) {
  const { locale } = useI18n();
  const [cryptoPulse, setCryptoPulse] = useState<CryptoMarketPulseModel | null>(null);
  const [cryptoPulseState, setCryptoPulseState] = useState<
    "idle" | "loading" | "loaded" | "failed"
  >("idle");
  const [kronosShadow, setKronosShadow] = useState<KronosShadowModel | null>(null);
  const [kronosShadowState, setKronosShadowState] = useState<
    "idle" | "loading" | "loaded" | "failed"
  >("idle");

  useEffect(() => {
    if (!authenticated || market !== "crypto") {
      setCryptoPulse(null);
      setCryptoPulseState("idle");
      return;
    }
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
  }, [authenticated, market]);

  useEffect(() => {
    if (!authenticated || market !== "crypto") {
      setKronosShadow(null);
      setKronosShadowState("idle");
      return;
    }
    const controller = new AbortController();
    setKronosShadow(null);
    setKronosShadowState("loading");
    fetchParsed(
      "/api/smart-insights/forecast/BTC?model=kronos-small",
      kronosShadowSchema,
      controller.signal,
    )
      .then((payload) => {
        if (!controller.signal.aborted) {
          setKronosShadow(payload);
          setKronosShadowState("loaded");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setKronosShadowState("failed");
      });
    return () => controller.abort();
  }, [authenticated, market]);

  const marketMetrics = useMemo(
    () => metrics.filter((metric) => metric.market === market),
    [market, metrics],
  );
  const cryptoMetrics = useMemo(
    () => metrics.filter((metric) => metric.market === "crypto"),
    [metrics],
  );
  const selectedRegime = regimes.find((regime) => regime.market === market);

  return (
    <section className="space-y-6" aria-labelledby="market-pulse-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="market-pulse-heading" className="text-2xl font-bold tracking-tight">
              Market Pulse
            </h2>
            <Badge variant="outline">{locale === "vi" ? "Dữ liệu hiện tại" : "Current data"}</Badge>
          </div>
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
          <CryptoQuantPulseTabs
            cryptoPulse={cryptoPulse}
            cryptoPulseState={cryptoPulseState}
            metrics={cryptoMetrics}
            regime={regimes.find((regime) => regime.market === "crypto")}
            locale={locale}
            kronosShadow={kronosShadow}
            kronosShadowState={kronosShadowState}
          />
        </TabsContent>
        <TabsContent value="macro" className="mt-4">
          <MacroQuantPulseTabs
            regimeContent={<MetricGrid market="macro" metrics={marketMetrics} locale={locale} />}
            eventRisk={macroEventRisk}
            energy={energyPulse}
            state={macroPulseState}
            locale={locale}
          />
        </TabsContent>
        <TabsContent value="gold" className="mt-4">
          <MetricGrid market="gold" metrics={marketMetrics} locale={locale} />
        </TabsContent>
      </Tabs>
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
                  {formatMarketMetric(metric, locale)}
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
