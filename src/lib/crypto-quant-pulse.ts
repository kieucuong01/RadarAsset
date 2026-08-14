import type { CryptoMarketPulseModel } from "@/lib/crypto-market-pulse-client";
import type { MetricModel } from "@/lib/smart-insights-client";

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

export type CryptoMetricPoint = {
  effectiveAt: string;
  value: number;
  sourceCode: string;
  sourceUrl: string;
  freshness: MetricModel["freshness"];
};

export type CryptoMetricSeries = {
  key: string;
  metricCode: string;
  asset: string | null;
  unit: string;
  latest: CryptoMetricPoint;
  points: CryptoMetricPoint[];
  trendPoints: CryptoMetricPoint[];
};

export type CryptoOverviewObservation = {
  kind: "sentiment" | "etf" | "onchain";
  label: string;
  value: number;
  unit: string;
  sourceCode: string;
  sourceUrl: string;
  effectiveAt: string;
  freshness: MetricModel["freshness"];
};

function seriesKey(metricCode: string, asset: string | null, unit: string) {
  return [metricCode, asset ?? "global", unit].join("__").replace(/[^a-zA-Z0-9_]/g, "_");
}

export function buildCryptoMetricSeries(
  metrics: MetricModel[],
  codes: ReadonlySet<string>,
): CryptoMetricSeries[] {
  const grouped = new Map<string, Omit<CryptoMetricSeries, "latest" | "trendPoints">>();

  for (const metric of metrics) {
    const value = Number(metric.value);
    if (
      metric.market !== "crypto" ||
      !codes.has(metric.metricCode) ||
      !Number.isFinite(value) ||
      metric.freshness === "conflicting" ||
      metric.freshness === "unavailable"
    ) {
      continue;
    }

    const key = seriesKey(metric.metricCode, metric.asset, metric.unit);
    const group = grouped.get(key) ?? {
      key,
      metricCode: metric.metricCode,
      asset: metric.asset,
      unit: metric.unit,
      points: [],
    };
    group.points.push({
      effectiveAt: metric.effectiveStart,
      value,
      sourceCode: metric.sourceCode,
      sourceUrl: metric.sourceUrl,
      freshness: metric.freshness,
    });
    grouped.set(key, group);
  }

  return [...grouped.values()]
    .map((group) => {
      const points = [...group.points].sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
      return {
        ...group,
        points,
        latest: points[points.length - 1],
        trendPoints: points.length >= 2 ? points : [],
      };
    })
    .sort((a, b) =>
      `${a.metricCode}:${a.asset ?? ""}:${a.unit}`.localeCompare(
        `${b.metricCode}:${b.asset ?? ""}:${b.unit}`,
      ),
    );
}

export function mergeSeriesPoints(series: CryptoMetricSeries[]) {
  const rows = new Map<string, Record<string, string | number | null>>();
  for (const item of series) {
    for (const [index, point] of item.trendPoints.entries()) {
      const previous = item.trendPoints[index - 1];
      const previousTime = previous ? Date.parse(previous.effectiveAt) : Number.NaN;
      const currentTime = Date.parse(point.effectiveAt);
      if (
        Number.isFinite(previousTime) &&
        Number.isFinite(currentTime) &&
        currentTime - previousTime > 36 * 60 * 60 * 1_000
      ) {
        const breakpointAt = new Date(previousTime + 24 * 60 * 60 * 1_000).toISOString();
        const breakpoint = rows.get(breakpointAt) ?? { effectiveAt: breakpointAt };
        breakpoint[item.key] = null;
        rows.set(breakpointAt, breakpoint);
      }
      const row = rows.get(point.effectiveAt) ?? { effectiveAt: point.effectiveAt };
      row[item.key] = point.value;
      rows.set(point.effectiveAt, row);
    }
  }
  return [...rows.values()].sort((a, b) =>
    String(a.effectiveAt).localeCompare(String(b.effectiveAt)),
  );
}

const ONCHAIN_OVERVIEW_PRIORITY = [
  "crypto.onchain.adjusted_transfer_change_30d",
  "crypto.onchain.active_addresses_change_30d",
  "crypto.stablecoin.supply_change_7d",
] as const;

function pulseFreshness(
  effectiveAt: string,
  generatedAt: string,
): CryptoOverviewObservation["freshness"] {
  const effectiveTime = Date.parse(effectiveAt);
  const generatedTime = Date.parse(generatedAt);
  if (!Number.isFinite(effectiveTime) || !Number.isFinite(generatedTime)) return "unavailable";
  return generatedTime - effectiveTime <= 48 * 60 * 60 * 1_000 ? "fresh" : "stale";
}

export function buildCryptoOverviewObservations(
  pulse: CryptoMarketPulseModel | null,
  metrics: MetricModel[],
): CryptoOverviewObservation[] {
  const observations: CryptoOverviewObservation[] = [];
  if (pulse) {
    const fearGreed = pulse.fearGreed.latest;
    if (pulse.fearGreed.status !== "unavailable" && fearGreed) {
      observations.push({
        kind: "sentiment",
        label: `Fear & Greed: ${fearGreed.value} (${fearGreed.classification})`,
        value: fearGreed.value,
        unit: "index",
        sourceCode: pulse.fearGreed.sourceCode,
        sourceUrl: pulse.fearGreed.sourceUrl,
        effectiveAt: fearGreed.effectiveAt,
        freshness: pulseFreshness(fearGreed.effectiveAt, pulse.generatedAt),
      });
    }

    const latestEtf = [...pulse.etfFlows.series]
      .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
      .at(-1);
    if (pulse.etfFlows.status !== "unavailable" && latestEtf) {
      const etfFreshness = pulseFreshness(latestEtf.effectiveAt, pulse.generatedAt);
      observations.push({
        kind: "etf",
        label: "ETF flow phiên gần nhất",
        value: latestEtf.total,
        unit: "USD",
        sourceCode: pulse.etfFlows.sourceCodes.join(", "),
        sourceUrl: "https://farside.co.uk",
        effectiveAt: latestEtf.effectiveAt,
        freshness:
          etfFreshness !== "fresh"
            ? etfFreshness
            : pulse.etfFlows.status === "partial"
              ? "partial"
              : "fresh",
      });
    }
  }

  const onchain = ONCHAIN_OVERVIEW_PRIORITY.flatMap((metricCode) =>
    metrics
      .filter(
        (metric) =>
          metric.market === "crypto" &&
          metric.metricCode === metricCode &&
          metric.freshness !== "conflicting" &&
          metric.freshness !== "unavailable",
      )
      .sort((a, b) => b.effectiveStart.localeCompare(a.effectiveStart)),
  ).find((metric) => Number.isFinite(Number(metric.value)));
  if (onchain) {
    observations.push({
      kind: "onchain",
      label: onchain.metricCode.includes("active_addresses")
        ? "Địa chỉ hoạt động, thay đổi 30 ngày"
        : onchain.metricCode.includes("stablecoin")
          ? "Nguồn cung stablecoin, thay đổi 7 ngày"
          : "Giá trị chuyển on-chain, thay đổi 30 ngày",
      value: Number(onchain.value),
      unit: onchain.unit,
      sourceCode: onchain.sourceCode,
      sourceUrl: onchain.sourceUrl,
      effectiveAt: onchain.effectiveStart,
      freshness: onchain.freshness,
    });
  }

  return observations;
}
