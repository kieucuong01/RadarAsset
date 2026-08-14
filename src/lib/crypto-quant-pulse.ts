import type { CryptoMarketPulseModel } from "./crypto-market-pulse-client";
import type { MetricModel } from "./smart-insights-client";

export const DERIVATIVE_METRIC_CODES = new Set([
  "crypto.derivatives.btc_dvol",
  "crypto.derivatives.eth_dvol",
  "crypto.derivatives.funding_rate",
  "crypto.derivatives.open_interest",
]);

export const ONCHAIN_METRIC_CODES = new Set([
  "crypto.onchain.active_addresses",
  "crypto.onchain.adjusted_transfer_usd",
  "crypto.onchain.mvrv",
  "crypto.onchain.nvt",
  "crypto.stablecoin.supply_usd",
]);

export type CryptoMetricPoint = { effectiveAt: string; value: number };

export type CryptoMetricSeries = {
  key: string;
  metricCode: string;
  asset: string | null;
  unit: string;
  sourceCode: string;
  sourceUrl: string;
  freshness: MetricModel["freshness"];
  observedAt: string;
  points: CryptoMetricPoint[];
  trendPoints: CryptoMetricPoint[];
};

export type CryptoOverviewObservation = {
  code: string;
  label: string;
  displayValue: string;
  sourceCode: string;
  sourceUrl: string;
  effectiveAt: string;
};

export function buildCryptoMetricSeries(metrics: MetricModel[]): CryptoMetricSeries[] {
  const groups = new Map<string, { metrics: MetricModel[]; firstIndex: number }>();

  metrics.forEach((metric, index) => {
    const value = Number(metric.value);
    if (!Number.isFinite(value)) return;
    const key = [metric.metricCode, metric.asset ?? "global", metric.unit, metric.sourceCode].join(
      ":",
    );
    const group = groups.get(key) ?? { metrics: [], firstIndex: index };
    group.metrics.push(metric);
    groups.set(key, group);
  });

  return [...groups.entries()]
    .sort(([, left], [, right]) => left.firstIndex - right.firstIndex)
    .map(([key, group]) => {
      const sorted = [...group.metrics].sort(
        (left, right) => Date.parse(left.effectiveStart) - Date.parse(right.effectiveStart),
      );
      const latest = sorted.at(-1)!;
      const points = sorted.map((metric) => ({
        effectiveAt: metric.effectiveStart,
        value: Number(metric.value),
      }));
      return {
        key,
        metricCode: latest.metricCode,
        asset: latest.asset,
        unit: latest.unit,
        sourceCode: latest.sourceCode,
        sourceUrl: latest.sourceUrl,
        freshness: latest.freshness,
        observedAt: latest.observedAt,
        points,
        trendPoints: points.length > 1 ? points : [],
      };
    });
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function buildCryptoOverviewObservations(
  pulse: CryptoMarketPulseModel | null,
): CryptoOverviewObservation[] {
  if (!pulse) return [];
  const observations: CryptoOverviewObservation[] = [];
  const cbbi = pulse.cycleIndicators.cbbi.latest;
  if (cbbi) {
    observations.push({
      code: "cbbi-confidence",
      label: "CBBI Confidence",
      displayValue: percent(cbbi.confidence),
      sourceCode: pulse.cycleIndicators.cbbi.sourceCode,
      sourceUrl: pulse.cycleIndicators.cbbi.sourceUrl,
      effectiveAt: cbbi.effectiveAt,
    });
  }

  const altcoin = pulse.cycleIndicators.altcoinSeason.latest;
  if (altcoin?.season90d != null) {
    observations.push({
      code: "altcoin-season-90d",
      label: "Altcoin Season · 90D",
      displayValue: `${altcoin.season90d.toFixed(0)} / 100`,
      sourceCode: pulse.cycleIndicators.altcoinSeason.sourceCode,
      sourceUrl: pulse.cycleIndicators.altcoinSeason.sourceUrl,
      effectiveAt: altcoin.effectiveAt,
    });
  }

  const btcMaxPain = pulse.liquidationMaxPain.rows.find((row) => row.asset === "BTC");
  if (btcMaxPain && (btcMaxPain.long || btcMaxPain.short)) {
    const sides = [
      btcMaxPain.long ? `Long ${percent(btcMaxPain.long.distanceRatio * 100)}` : null,
      btcMaxPain.short ? `Short ${percent(btcMaxPain.short.distanceRatio * 100)}` : null,
    ].filter(Boolean);
    observations.push({
      code: "btc-liquidation-distance",
      label: "BTC Liquidation Max Pain · 24H",
      displayValue: sides.join(" · "),
      sourceCode: pulse.liquidationMaxPain.sourceCode,
      sourceUrl: pulse.liquidationMaxPain.sourceUrl,
      effectiveAt: btcMaxPain.effectiveAt,
    });
  }

  const fearGreed = pulse.fearGreed.latest;
  if (fearGreed) {
    observations.push({
      code: "fear-greed",
      label: "Fear & Greed",
      displayValue: `${fearGreed.value.toFixed(0)} · ${fearGreed.classification}`,
      sourceCode: pulse.fearGreed.sourceCode,
      sourceUrl: pulse.fearGreed.sourceUrl,
      effectiveAt: fearGreed.effectiveAt,
    });
  }

  const latestEtf = pulse.etfFlows.series.at(-1);
  if (latestEtf) {
    observations.push({
      code: "etf-total",
      label: "ETF Flow · Total",
      displayValue: new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(latestEtf.total),
      sourceCode: pulse.etfFlows.sourceCodes.join(", ") || "farside",
      sourceUrl: "https://farside.co.uk/",
      effectiveAt: latestEtf.effectiveAt,
    });
  }

  return observations.slice(0, 3);
}
