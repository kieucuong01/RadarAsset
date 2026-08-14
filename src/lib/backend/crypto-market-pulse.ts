import type { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db/prisma";

const ALTERNATIVE_SOURCE_URL = "https://alternative.me/crypto/fear-and-greed-index/";
const COINSHARES_SOURCE_URL = "https://coinshares.com/corp/resources/market-activity/";
const COINGLASS_MARGIN_URL = "https://www.coinglass.com/pro/i/MarginFeeChart";
const COINGLASS_MAXPAIN_URL = "https://www.coinglass.com/liquidation-maxpain";
const ALTCOIN_SEASON_URL = "https://www.blockchaincenter.net/altcoin-season-index/";
const CBBI_URL = "https://colintalkscrypto.com/cbbi/";
const FARSIDE_PROVIDERS = ["farside-btc-etf", "farside-eth-etf", "farside-sol-etf"] as const;
const ACCEPTED_QUALITY = ["passed", "warning"];
const DAY_MS = 86_400_000;
const LARGE_ADDRESS_METRICS = [
  "crypto.large_address.confirmed_balance_btc",
  "crypto.large_address.to_exchange_btc",
  "crypto.large_address.from_exchange_btc",
  "crypto.large_address.confirmed_incoming_btc",
  "crypto.large_address.confirmed_outgoing_btc",
  "crypto.large_address.address_balance_btc",
  "crypto.large_address.balance_change_btc",
] as const;
const PRESSURE_METRICS = [
  "crypto.derivatives.margin_borrow.annualized_rate",
  "crypto.derivatives.margin_borrow.daily_rate",
  "crypto.derivatives.margin_borrow.hourly_rate",
  "crypto.derivatives.liquidation.current_price_usd",
  "crypto.derivatives.liquidation.long_max_pain_price_usd",
  "crypto.derivatives.liquidation.short_max_pain_price_usd",
  "crypto.derivatives.liquidation.long_max_pain_level_usd",
  "crypto.derivatives.liquidation.short_max_pain_level_usd",
  "crypto.derivatives.liquidation.long_distance_ratio",
  "crypto.derivatives.liquidation.short_distance_ratio",
] as const;
export const CBBI_COMPONENT_CODES = [
  "pi_cycle",
  "rupl_nupl",
  "rhodl",
  "puell",
  "two_year_ma",
  "trolololo",
  "mvrv",
  "reserve_risk",
  "woobull",
] as const;
const CYCLE_METRICS = [
  "crypto.cycle.altcoin_season.index",
  "crypto.cycle.cbbi.confidence",
  ...CBBI_COMPONENT_CODES.map((code) => `crypto.cycle.cbbi.component.${code}`),
] as const;

type AssetCode = "BTC" | "ETH" | "SOL";

type ObservationRow = {
  naturalKey: string;
  effectiveAt: Date;
  value: { toString(): string };
  revision: number;
  observedAt?: Date;
  dimensions: Prisma.JsonValue;
  qualityFlags?: Prisma.JsonValue;
  provider?: { code: string };
  metricDefinition?: { code: string };
  rawSnapshot?: { sourceUrl: string };
  asset?: { symbol: string } | null;
};

type LargeAddressHorizon = {
  netAccumulationBtc: number | null;
  accumulationBreadth: number | null;
  distributionBreadth: number | null;
  accumulatingCount: number | null;
  distributingCount: number | null;
  unchangedCount: number | null;
};

type LargeAddressState =
  | "accumulation"
  | "neutral"
  | "distribution"
  | "calibrating"
  | "unavailable";

export type CryptoMarketPulseResponse = {
  generatedAt: string;
  fearGreed: {
    status: "system" | "unavailable";
    sourceCode: "alternative-fng";
    sourceUrl: string;
    latest: { effectiveAt: string; value: number; classification: string } | null;
    series: Array<{ effectiveAt: string; value: number; classification: string }>;
  };
  etfFlows: {
    status: "system" | "partial" | "unavailable";
    sourceCodes: string[];
    series: Array<{
      effectiveAt: string;
      btc: number | null;
      eth: number | null;
      sol: number | null;
      total: number;
    }>;
    summaries: Array<{
      asset: AssetCode;
      latest: number | null;
      fiveDay: number | null;
      thirtyDay: number | null;
      latestEffectiveAt: string | null;
    }>;
  };
  fundFlows: {
    status: "system" | "unavailable";
    sourceCode: "coinshares-weekly";
    sourceUrl: string;
    series: Array<{
      effectiveAt: string;
      total: number;
      assets: Array<{ label: string; value: number }>;
    }>;
    latestBreakdown: Array<{ label: string; value: number }>;
  };
  marginBorrow: {
    status: "system" | "partial" | "unavailable";
    sourceCode: "coinglass-margin-borrow";
    sourceUrl: string;
    observedAt: string | null;
    series: Array<{
      effectiveAt: string;
      annualizedRate: number | null;
      dailyRate: number | null;
      hourlyRate: number | null;
    }>;
  };
  liquidationMaxPain: {
    status: "system" | "partial" | "unavailable";
    sourceCode: "coinglass-liquidation-maxpain";
    sourceUrl: string;
    observedAt: string | null;
    rows: Array<{
      asset: AssetCode;
      range: "24h";
      effectiveAt: string;
      currentPriceUsd: number | null;
      long: { priceUsd: number; levelUsd: number; distanceRatio: number } | null;
      short: { priceUsd: number; levelUsd: number; distanceRatio: number } | null;
    }>;
  };
  cycleIndicators: {
    altcoinSeason: {
      status: "system" | "partial" | "unavailable";
      sourceCode: "blockchaincenter-altcoin-season";
      sourceUrl: string;
      observedAt: string | null;
      latest: {
        effectiveAt: string;
        season90d: number | null;
        month: number | null;
        year: number | null;
        classification: "bitcoin_season" | "neutral" | "altcoin_season" | null;
      } | null;
      series: Array<{
        effectiveAt: string;
        season90d: number | null;
        month: number | null;
        year: number | null;
      }>;
    };
    cbbi: {
      status: "system" | "partial" | "unavailable";
      sourceCode: "cbbi-public";
      sourceUrl: string;
      observedAt: string | null;
      latest: {
        effectiveAt: string;
        confidence: number;
        components: Array<{ code: (typeof CBBI_COMPONENT_CODES)[number]; value: number }>;
      } | null;
      series: Array<{
        effectiveAt: string;
        confidence: number;
        components: Array<{ code: (typeof CBBI_COMPONENT_CODES)[number]; value: number }>;
      }>;
    };
  };
  largeAddressActivity: {
    status: "system" | "partial" | "unavailable";
    sourceCodes: string[];
    effectiveAt: string | null;
    universeObservedAt: string | null;
    score: number | null;
    state: LargeAddressState;
    confidence: number | null;
    calibrationStatus: "calibrating" | "calibrated" | "unavailable";
    horizons: {
      oneDay: LargeAddressHorizon;
      sevenDay: LargeAddressHorizon;
      thirtyDay: LargeAddressHorizon;
    };
    exchangeFlows: Array<{
      effectiveAt: string;
      toExchangeBtc: number;
      fromExchangeBtc: number;
      pressureBtc: number;
    }>;
    concentrationSeries: Array<{ effectiveAt: string; top10Ratio: number }>;
    breadthSeries: Array<{
      effectiveAt: string;
      netAccumulationBtc: number;
      accumulationBreadth: number;
      distributionBreadth: number;
      accumulatingCount: number;
      distributingCount: number;
      unchangedCount: number;
    }>;
    notableActivity: Array<{
      effectiveAt: string;
      address: string;
      valueBtc: number;
      direction: "incoming" | "outgoing";
      counterparty: string;
      txid: string;
      sourceUrl: string;
      explorerUrl: string;
    }>;
    entrantsExits: {
      entrantCount: number;
      exitCount: number;
      entrantBalanceBtc: number;
      exitBalanceBtc: number;
    } | null;
    qualityFlags: string[];
    sources: Array<{ sourceCode: string; sourceUrl: string; observedAt: string | null }>;
    methodologyVersion: string | null;
  };
};

export function classifyFearGreed(value: number): string {
  if (value <= 24) return "Extreme Fear";
  if (value <= 44) return "Fear";
  if (value <= 54) return "Neutral";
  if (value <= 74) return "Greed";
  return "Extreme Greed";
}

export function classifyAltcoinSeason(value: number) {
  if (value <= 25) return "bitcoin_season" as const;
  if (value >= 75) return "altcoin_season" as const;
  return "neutral" as const;
}

function object(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function latestRevision<T extends { naturalKey: string; revision: number }>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const current = latest.get(row.naturalKey);
    if (!current || row.revision > current.revision) latest.set(row.naturalKey, row);
  }
  return [...latest.values()];
}

function number(row: ObservationRow): number {
  return Number(row.value.toString());
}

function sumOrNull(values: Array<number | null>): number | null {
  const reported = values.filter((value): value is number => value !== null);
  return reported.length ? reported.reduce((sum, value) => sum + value, 0) : null;
}

function providerAsset(code: string): AssetCode | null {
  if (code === "farside-btc-etf") return "BTC";
  if (code === "farside-eth-etf") return "ETH";
  if (code === "farside-sol-etf") return "SOL";
  return null;
}

function latestObservedAt(rows: ObservationRow[]): string | null {
  return (
    rows
      .map((row) => row.observedAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0]
      ?.toISOString() ?? null
  );
}

function buildMarginBorrow(rows: ObservationRow[]): CryptoMarketPulseResponse["marginBorrow"] {
  const accepted = latestRevision(rows).filter(
    (row) => row.provider?.code === "coinglass-margin-borrow",
  );
  const grouped = new Map<
    string,
    {
      effectiveAt: string;
      annualizedRate: number | null;
      dailyRate: number | null;
      hourlyRate: number | null;
    }
  >();
  for (const row of accepted) {
    const effectiveAt = row.effectiveAt.toISOString();
    const point = grouped.get(effectiveAt) ?? {
      effectiveAt,
      annualizedRate: null,
      dailyRate: null,
      hourlyRate: null,
    };
    const code = metricCode(row);
    if (code.endsWith("annualized_rate")) point.annualizedRate = number(row);
    else if (code.endsWith("daily_rate")) point.dailyRate = number(row);
    else if (code.endsWith("hourly_rate")) point.hourlyRate = number(row);
    grouped.set(effectiveAt, point);
  }
  const series = [...grouped.values()].sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
  const latest = series.at(-1);
  const complete =
    latest != null &&
    latest.annualizedRate != null &&
    latest.dailyRate != null &&
    latest.hourlyRate != null;
  return {
    status: !latest ? "unavailable" : complete ? "system" : "partial",
    sourceCode: "coinglass-margin-borrow",
    sourceUrl: accepted.at(-1)?.rawSnapshot?.sourceUrl ?? COINGLASS_MARGIN_URL,
    observedAt: latestObservedAt(accepted),
    series,
  };
}

type LiquidationAccumulator = {
  asset: AssetCode;
  range: "24h";
  effectiveAt: string;
  currentPriceUsd: number | null;
  longPrice: number | null;
  longLevel: number | null;
  longDistance: number | null;
  shortPrice: number | null;
  shortLevel: number | null;
  shortDistance: number | null;
};

function buildLiquidationMaxPain(
  rows: ObservationRow[],
): CryptoMarketPulseResponse["liquidationMaxPain"] {
  const accepted = latestRevision(rows).filter(
    (row) => row.provider?.code === "coinglass-liquidation-maxpain",
  );
  const assets = new Set<AssetCode>(["BTC", "ETH", "SOL"]);
  const grouped = new Map<string, LiquidationAccumulator>();
  for (const row of accepted) {
    const rowDimensions = dimensions(row);
    const rawAsset = row.asset?.symbol ?? rowDimensions.asset;
    if (typeof rawAsset !== "string" || !assets.has(rawAsset as AssetCode)) continue;
    if (rowDimensions.range !== "24h") continue;
    const asset = rawAsset as AssetCode;
    const effectiveAt = row.effectiveAt.toISOString();
    const key = `${effectiveAt}:${asset}:24h`;
    const item = grouped.get(key) ?? {
      asset,
      range: "24h",
      effectiveAt,
      currentPriceUsd: null,
      longPrice: null,
      longLevel: null,
      longDistance: null,
      shortPrice: null,
      shortLevel: null,
      shortDistance: null,
    };
    const code = metricCode(row);
    if (code.endsWith("current_price_usd")) item.currentPriceUsd = number(row);
    else if (code.endsWith("long_max_pain_price_usd")) item.longPrice = number(row);
    else if (code.endsWith("long_max_pain_level_usd")) item.longLevel = number(row);
    else if (code.endsWith("long_distance_ratio")) item.longDistance = number(row);
    else if (code.endsWith("short_max_pain_price_usd")) item.shortPrice = number(row);
    else if (code.endsWith("short_max_pain_level_usd")) item.shortLevel = number(row);
    else if (code.endsWith("short_distance_ratio")) item.shortDistance = number(row);
    grouped.set(key, item);
  }
  const latestByAsset = new Map<AssetCode, LiquidationAccumulator>();
  for (const item of grouped.values()) {
    const current = latestByAsset.get(item.asset);
    if (!current || item.effectiveAt > current.effectiveAt) latestByAsset.set(item.asset, item);
  }
  const order: AssetCode[] = ["BTC", "ETH", "SOL"];
  const rowsOut = [...latestByAsset.values()]
    .sort((a, b) => order.indexOf(a.asset) - order.indexOf(b.asset))
    .map((item) => ({
      asset: item.asset,
      range: item.range,
      effectiveAt: item.effectiveAt,
      currentPriceUsd: item.currentPriceUsd,
      long:
        item.longPrice != null && item.longLevel != null && item.longDistance != null
          ? { priceUsd: item.longPrice, levelUsd: item.longLevel, distanceRatio: item.longDistance }
          : null,
      short:
        item.shortPrice != null && item.shortLevel != null && item.shortDistance != null
          ? {
              priceUsd: item.shortPrice,
              levelUsd: item.shortLevel,
              distanceRatio: item.shortDistance,
            }
          : null,
    }));
  const complete =
    rowsOut.length > 0 &&
    rowsOut.every((row) => row.currentPriceUsd != null && row.long && row.short);
  return {
    status: rowsOut.length === 0 ? "unavailable" : complete ? "system" : "partial",
    sourceCode: "coinglass-liquidation-maxpain",
    sourceUrl: accepted.at(-1)?.rawSnapshot?.sourceUrl ?? COINGLASS_MAXPAIN_URL,
    observedAt: latestObservedAt(accepted),
    rows: rowsOut,
  };
}

function buildCycleIndicators(
  rows: ObservationRow[],
): CryptoMarketPulseResponse["cycleIndicators"] {
  const accepted = latestRevision(rows);
  const altRows = accepted.filter(
    (row) => row.provider?.code === "blockchaincenter-altcoin-season",
  );
  const altGrouped = new Map<
    string,
    { effectiveAt: string; season90d: number | null; month: number | null; year: number | null }
  >();
  for (const row of altRows) {
    const effectiveAt = row.effectiveAt.toISOString();
    const item = altGrouped.get(effectiveAt) ?? {
      effectiveAt,
      season90d: null,
      month: null,
      year: null,
    };
    const horizon = dimensions(row).horizon;
    if (horizon === "season_90d") item.season90d = number(row);
    else if (horizon === "month") item.month = number(row);
    else if (horizon === "year") item.year = number(row);
    altGrouped.set(effectiveAt, item);
  }
  const altSeries = [...altGrouped.values()].sort((a, b) =>
    a.effectiveAt.localeCompare(b.effectiveAt),
  );
  const latestAltPoint = altSeries.at(-1);
  const latestAlt = latestAltPoint
    ? {
        ...latestAltPoint,
        classification:
          latestAltPoint.season90d == null ? null : classifyAltcoinSeason(latestAltPoint.season90d),
      }
    : null;
  const altComplete =
    latestAlt != null &&
    latestAlt.season90d != null &&
    latestAlt.month != null &&
    latestAlt.year != null;

  const cbbiRows = accepted.filter((row) => row.provider?.code === "cbbi-public");
  const componentSet = new Set<string>(CBBI_COMPONENT_CODES);
  const cbbiGrouped = new Map<
    string,
    { effectiveAt: string; confidence: number | null; components: Map<string, number> }
  >();
  for (const row of cbbiRows) {
    const effectiveAt = row.effectiveAt.toISOString();
    const item = cbbiGrouped.get(effectiveAt) ?? {
      effectiveAt,
      confidence: null,
      components: new Map<string, number>(),
    };
    const code = metricCode(row);
    if (code === "crypto.cycle.cbbi.confidence") item.confidence = number(row);
    else if (code.startsWith("crypto.cycle.cbbi.component.")) {
      const component = code.slice("crypto.cycle.cbbi.component.".length);
      if (componentSet.has(component)) item.components.set(component, number(row));
    }
    cbbiGrouped.set(effectiveAt, item);
  }
  const cbbiSeries = [...cbbiGrouped.values()]
    .filter((item) => item.confidence != null)
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
    .map((item) => ({
      effectiveAt: item.effectiveAt,
      confidence: item.confidence!,
      components: CBBI_COMPONENT_CODES.filter((code) => item.components.has(code)).map((code) => ({
        code,
        value: item.components.get(code)!,
      })),
    }));
  const latestCbbi = cbbiSeries.at(-1) ?? null;
  return {
    altcoinSeason: {
      status: !latestAlt ? "unavailable" : altComplete ? "system" : "partial",
      sourceCode: "blockchaincenter-altcoin-season",
      sourceUrl: altRows.at(-1)?.rawSnapshot?.sourceUrl ?? ALTCOIN_SEASON_URL,
      observedAt: latestObservedAt(altRows),
      latest: latestAlt,
      series: altSeries,
    },
    cbbi: {
      status: !latestCbbi
        ? "unavailable"
        : latestCbbi.components.length === CBBI_COMPONENT_CODES.length
          ? "system"
          : "partial",
      sourceCode: "cbbi-public",
      sourceUrl: cbbiRows.at(-1)?.rawSnapshot?.sourceUrl ?? CBBI_URL,
      observedAt: latestObservedAt(cbbiRows),
      latest: latestCbbi,
      series: cbbiSeries,
    },
  };
}

const EMPTY_HORIZON: LargeAddressHorizon = {
  netAccumulationBtc: null,
  accumulationBreadth: null,
  distributionBreadth: null,
  accumulatingCount: null,
  distributingCount: null,
  unchangedCount: null,
};

function dimensions(row: ObservationRow): Record<string, unknown> {
  return object(row.dimensions);
}

function metricCode(row: ObservationRow): string {
  return row.metricDefinition?.code ?? "";
}

function addressDays(rows: ObservationRow[]) {
  const grouped = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (metricCode(row) !== "crypto.large_address.confirmed_balance_btc") continue;
    const address = dimensions(row).address;
    if (typeof address !== "string") continue;
    const effectiveAt = row.effectiveAt.toISOString();
    const period = grouped.get(effectiveAt) ?? new Map<string, number>();
    period.set(address, number(row));
    grouped.set(effectiveAt, period);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([effectiveAt, balances]) => ({ effectiveAt, balances }));
}

function commonHorizon(
  current: Map<string, number>,
  previous: Map<string, number>,
): LargeAddressHorizon {
  const common = [...current.keys()].filter((address) => previous.has(address));
  if (!common.length) return { ...EMPTY_HORIZON };
  let net = 0;
  let accumulating = 0;
  let distributing = 0;
  let unchanged = 0;
  for (const address of common) {
    const before = previous.get(address)!;
    const change = current.get(address)! - before;
    net += change;
    const threshold = Math.max(10, Math.abs(before) * 0.001);
    if (change > threshold) accumulating += 1;
    else if (change < -threshold) distributing += 1;
    else unchanged += 1;
  }
  return {
    netAccumulationBtc: net,
    accumulationBreadth: accumulating / common.length,
    distributionBreadth: distributing / common.length,
    accumulatingCount: accumulating,
    distributingCount: distributing,
    unchangedCount: unchanged,
  };
}

function horizonAt(days: ReturnType<typeof addressDays>, lookback: number): LargeAddressHorizon {
  const current = days.at(-1);
  const previous = days.at(-(lookback + 1));
  return current && previous
    ? commonHorizon(current.balances, previous.balances)
    : { ...EMPTY_HORIZON };
}

function buildLargeAddressActivity(
  rows: ObservationRow[],
  signal: {
    score: { toString(): string } | null;
    label: string;
    dataConfidence: { toString(): string };
    status: string;
    effectiveAt: Date;
    methodologyVersion: string;
  } | null,
): CryptoMarketPulseResponse["largeAddressActivity"] {
  const accepted = latestRevision(rows);
  const days = addressDays(accepted);
  const breadthSeries = days.slice(1).map((day, index) => ({
    effectiveAt: day.effectiveAt,
    ...commonHorizon(day.balances, days[index]!.balances),
  }));
  const normalizedBreadth = breadthSeries.map((row) => ({
    effectiveAt: row.effectiveAt,
    netAccumulationBtc: row.netAccumulationBtc ?? 0,
    accumulationBreadth: row.accumulationBreadth ?? 0,
    distributionBreadth: row.distributionBreadth ?? 0,
    accumulatingCount: row.accumulatingCount ?? 0,
    distributingCount: row.distributingCount ?? 0,
    unchangedCount: row.unchangedCount ?? 0,
  }));
  const concentrationSeries = days.map((day) => {
    const ordered = [...day.balances.values()].sort((a, b) => b - a);
    const total = ordered.reduce((sum, value) => sum + value, 0);
    return {
      effectiveAt: day.effectiveAt,
      top10Ratio: total ? ordered.slice(0, 10).reduce((sum, value) => sum + value, 0) / total : 0,
    };
  });
  const flows = new Map<string, { toExchangeBtc: number; fromExchangeBtc: number }>();
  for (const row of accepted) {
    const code = metricCode(row);
    if (
      code !== "crypto.large_address.to_exchange_btc" &&
      code !== "crypto.large_address.from_exchange_btc"
    )
      continue;
    const effectiveAt = row.effectiveAt.toISOString();
    const period = flows.get(effectiveAt) ?? { toExchangeBtc: 0, fromExchangeBtc: 0 };
    if (code.endsWith("to_exchange_btc")) period.toExchangeBtc = number(row);
    else period.fromExchangeBtc = number(row);
    flows.set(effectiveAt, period);
  }
  const exchangeFlows = [...flows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([effectiveAt, row]) => ({
      effectiveAt,
      ...row,
      pressureBtc: row.toExchangeBtc - row.fromExchangeBtc,
    }));
  const notableActivity = accepted
    .filter((row) =>
      [
        "crypto.large_address.confirmed_incoming_btc",
        "crypto.large_address.confirmed_outgoing_btc",
      ].includes(metricCode(row)),
    )
    .map((row) => {
      const rowDimensions = dimensions(row);
      const txid = typeof rowDimensions.txid === "string" ? rowDimensions.txid : "";
      const direction =
        rowDimensions.direction === "incoming" ? ("incoming" as const) : ("outgoing" as const);
      return {
        effectiveAt: row.effectiveAt.toISOString(),
        address: typeof rowDimensions.address === "string" ? rowDimensions.address : "",
        valueBtc: number(row),
        direction,
        counterparty:
          typeof rowDimensions.counterparty === "string" ? rowDimensions.counterparty : "unknown",
        txid,
        sourceUrl: row.rawSnapshot?.sourceUrl ?? "https://mempool.space/",
        explorerUrl: txid ? `https://mempool.space/tx/${txid}` : "https://mempool.space/",
      };
    })
    .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))
    .slice(0, 25);
  const universeRows = accepted.filter(
    (row) => metricCode(row) === "crypto.large_address.address_balance_btc",
  );
  const universeObservedAt = universeRows
    .map((row) => row.observedAt)
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const membership = accepted
    .filter((row) => metricCode(row) === "crypto.large_address.balance_change_btc")
    .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())[0];
  const membershipDimensions = membership ? dimensions(membership) : {};
  const entrantsExits = membership
    ? {
        entrantCount: Number(membershipDimensions.entrant_count ?? 0),
        exitCount: Number(membershipDimensions.exit_count ?? 0),
        entrantBalanceBtc: Number(membershipDimensions.entrant_balance_btc ?? 0),
        exitBalanceBtc: Number(membershipDimensions.exit_balance_btc ?? 0),
      }
    : null;
  const sourceMap = new Map<
    string,
    { sourceCode: string; sourceUrl: string; observedAt: string | null }
  >();
  for (const row of accepted) {
    const sourceCode = row.provider?.code;
    if (!sourceCode) continue;
    const sourceUrl = row.rawSnapshot?.sourceUrl ?? "";
    sourceMap.set(`${sourceCode}:${sourceUrl}`, {
      sourceCode,
      sourceUrl,
      observedAt: row.observedAt?.toISOString() ?? null,
    });
  }
  const qualityFlags = [
    ...new Set(
      accepted.flatMap((row) =>
        Array.isArray(row.qualityFlags)
          ? row.qualityFlags.filter((flag): flag is string => typeof flag === "string")
          : [],
      ),
    ),
  ].sort();
  const score = signal?.score == null ? null : Number(signal.score.toString());
  const confidence = signal ? Number(signal.dataConfidence.toString()) : null;
  const allowedStates = new Set<LargeAddressState>([
    "accumulation",
    "neutral",
    "distribution",
    "calibrating",
    "unavailable",
  ]);
  const state = allowedStates.has(signal?.label as LargeAddressState)
    ? (signal!.label as LargeAddressState)
    : "unavailable";
  const status = days.length
    ? signal?.status === "active" && score !== null
      ? "system"
      : "partial"
    : "unavailable";
  return {
    status,
    sourceCodes: [
      ...new Set(accepted.map((row) => row.provider?.code).filter(Boolean) as string[]),
    ].sort(),
    effectiveAt: days.at(-1)?.effectiveAt ?? null,
    universeObservedAt: universeObservedAt?.toISOString() ?? null,
    score,
    state,
    confidence,
    calibrationStatus:
      state === "calibrating"
        ? "calibrating"
        : signal?.status === "active"
          ? "calibrated"
          : "unavailable",
    horizons: {
      oneDay: horizonAt(days, 1),
      sevenDay: horizonAt(days, 7),
      thirtyDay: horizonAt(days, 30),
    },
    exchangeFlows,
    concentrationSeries,
    breadthSeries: normalizedBreadth,
    notableActivity,
    entrantsExits,
    qualityFlags,
    sources: [...sourceMap.values()].sort((a, b) => a.sourceCode.localeCompare(b.sourceCode)),
    methodologyVersion: signal?.methodologyVersion ?? null,
  };
}

export async function loadCryptoMarketPulse(now = new Date()): Promise<CryptoMarketPulseResponse> {
  const prisma = getPrisma();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS);
  const thirtyOneDaysAgo = new Date(now.getTime() - 31 * DAY_MS);
  const cycleHistoryStart = new Date(now.getTime() - 730 * DAY_MS);
  const [
    rawFearRows,
    rawEtfRows,
    rawCoinSharesRows,
    rawLargeAddressRows,
    rawPressureRows,
    rawCycleRows,
    largeAddressSignal,
  ] = await Promise.all([
    prisma.metricObservation.findMany({
      where: {
        qualityStatus: { in: ACCEPTED_QUALITY },
        effectiveAt: { gte: thirtyDaysAgo, lte: now },
        metricDefinition: { code: "crypto.fear_greed.index" },
        provider: { code: "alternative-fng" },
      },
      orderBy: [{ effectiveAt: "asc" }, { revision: "desc" }],
      include: { rawSnapshot: { select: { sourceUrl: true } } },
    }),
    prisma.metricObservation.findMany({
      where: {
        qualityStatus: { in: ACCEPTED_QUALITY },
        effectiveAt: { gte: thirtyDaysAgo, lte: now },
        metricDefinition: { code: "crypto.etf.net_flow_usd" },
        provider: { code: { in: [...FARSIDE_PROVIDERS] } },
      },
      orderBy: [{ effectiveAt: "asc" }, { revision: "desc" }],
      include: { provider: { select: { code: true } } },
    }),
    prisma.metricObservation.findMany({
      where: {
        qualityStatus: { in: ACCEPTED_QUALITY },
        effectiveAt: { lte: now },
        metricDefinition: { code: "crypto.coinshares.net_flow_usd" },
        provider: { code: "coinshares-weekly" },
      },
      orderBy: [{ effectiveAt: "desc" }, { revision: "desc" }],
      take: 500,
    }),
    prisma.metricObservation.findMany({
      where: {
        qualityStatus: { in: ACCEPTED_QUALITY },
        effectiveAt: { gte: ninetyDaysAgo, lte: now },
        metricDefinition: { code: { in: [...LARGE_ADDRESS_METRICS] } },
        provider: {
          code: { in: ["mempool-btc-large-addresses", "bitinfocharts-top-addresses"] },
        },
      },
      orderBy: [{ effectiveAt: "asc" }, { revision: "desc" }],
      include: {
        metricDefinition: { select: { code: true } },
        provider: { select: { code: true } },
        rawSnapshot: { select: { sourceUrl: true } },
      },
    }),
    prisma.metricObservation.findMany({
      where: {
        qualityStatus: { in: ACCEPTED_QUALITY },
        effectiveAt: { gte: thirtyOneDaysAgo, lte: now },
        metricDefinition: { code: { in: [...PRESSURE_METRICS] } },
        provider: {
          code: { in: ["coinglass-margin-borrow", "coinglass-liquidation-maxpain"] },
        },
      },
      orderBy: [{ effectiveAt: "asc" }, { revision: "desc" }],
      include: {
        metricDefinition: { select: { code: true } },
        provider: { select: { code: true } },
        rawSnapshot: { select: { sourceUrl: true } },
        asset: { select: { symbol: true } },
      },
    }),
    prisma.metricObservation.findMany({
      where: {
        qualityStatus: { in: ACCEPTED_QUALITY },
        effectiveAt: { gte: cycleHistoryStart, lte: now },
        metricDefinition: { code: { in: [...CYCLE_METRICS] } },
        provider: { code: { in: ["blockchaincenter-altcoin-season", "cbbi-public"] } },
      },
      orderBy: [{ effectiveAt: "asc" }, { revision: "desc" }],
      include: {
        metricDefinition: { select: { code: true } },
        provider: { select: { code: true } },
        rawSnapshot: { select: { sourceUrl: true } },
      },
    }),
    prisma.signalSnapshot.findFirst({
      where: {
        market: "crypto",
        signalType: "large_address_action",
        effectiveAt: { lte: now },
        asset: { symbol: "BTC" },
      },
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
      select: {
        score: true,
        label: true,
        dataConfidence: true,
        status: true,
        effectiveAt: true,
        methodologyVersion: true,
      },
    }),
  ]);

  const fearRows = latestRevision(rawFearRows as unknown as ObservationRow[]).sort(
    (a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime(),
  );
  const fearSeries = fearRows.map((row) => {
    const value = number(row);
    return {
      effectiveAt: row.effectiveAt.toISOString(),
      value,
      classification: classifyFearGreed(value),
    };
  });

  const etfRows = latestRevision(rawEtfRows as unknown as ObservationRow[]).filter(
    (row) => object(row.dimensions).fund === "TOTAL",
  );
  const etfByDate = new Map<
    string,
    { effectiveAt: string; btc: number | null; eth: number | null; sol: number | null }
  >();
  const sourceCodes = new Set<string>();
  for (const row of etfRows) {
    const asset = providerAsset(row.provider?.code ?? "");
    if (!asset) continue;
    sourceCodes.add(row.provider!.code);
    const effectiveAt = row.effectiveAt.toISOString();
    const item = etfByDate.get(effectiveAt) ?? { effectiveAt, btc: null, eth: null, sol: null };
    item[asset.toLowerCase() as "btc" | "eth" | "sol"] = number(row);
    etfByDate.set(effectiveAt, item);
  }
  const etfSeries = [...etfByDate.values()]
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
    .map((row) => ({ ...row, total: sumOrNull([row.btc, row.eth, row.sol]) ?? 0 }));
  const summaries = (["BTC", "ETH", "SOL"] as const).map((asset) => {
    const key = asset.toLowerCase() as "btc" | "eth" | "sol";
    const reported = etfSeries
      .filter((row) => row[key] !== null)
      .map((row) => ({ effectiveAt: row.effectiveAt, value: row[key] as number }));
    return {
      asset,
      latest: reported.at(-1)?.value ?? null,
      fiveDay: sumOrNull(reported.slice(-5).map((row) => row.value)),
      thirtyDay: sumOrNull(reported.map((row) => row.value)),
      latestEffectiveAt: reported.at(-1)?.effectiveAt ?? null,
    };
  });

  const coinSharesRows = latestRevision(rawCoinSharesRows as unknown as ObservationRow[]).filter(
    (row) => typeof object(row.dimensions).asset === "string",
  );
  const coinDates = [...new Set(coinSharesRows.map((row) => row.effectiveAt.toISOString()))]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 12)
    .sort();
  const coinSeries = coinDates.map((effectiveAt) => {
    const rows = coinSharesRows.filter((row) => row.effectiveAt.toISOString() === effectiveAt);
    const assets = rows.map((row) => ({
      label: String(object(row.dimensions).asset),
      value: number(row),
    }));
    const providerTotal = assets.find((row) => row.label.toLowerCase() === "total");
    return {
      effectiveAt,
      total: providerTotal?.value ?? Number.NaN,
      assets: assets.filter((row) => row.label.toLowerCase() !== "total"),
    };
  });
  const trustedCoinSeries = coinSeries.every((row) => Number.isFinite(row.total)) ? coinSeries : [];
  const latestBreakdown = [...(trustedCoinSeries.at(-1)?.assets ?? [])].sort(
    (a, b) => Math.abs(b.value) - Math.abs(a.value),
  );

  const orderedSourceCodes = [...sourceCodes].sort(
    (a, b) =>
      FARSIDE_PROVIDERS.indexOf(a as (typeof FARSIDE_PROVIDERS)[number]) -
      FARSIDE_PROVIDERS.indexOf(b as (typeof FARSIDE_PROVIDERS)[number]),
  );
  return {
    generatedAt: now.toISOString(),
    fearGreed: {
      status: fearSeries.length ? "system" : "unavailable",
      sourceCode: "alternative-fng",
      sourceUrl: fearRows.at(-1)?.rawSnapshot?.sourceUrl ?? ALTERNATIVE_SOURCE_URL,
      latest: fearSeries.at(-1) ?? null,
      series: fearSeries,
    },
    etfFlows: {
      status:
        orderedSourceCodes.length === 0
          ? "unavailable"
          : orderedSourceCodes.length === FARSIDE_PROVIDERS.length
            ? "system"
            : "partial",
      sourceCodes: orderedSourceCodes,
      series: etfSeries,
      summaries,
    },
    fundFlows: {
      status: trustedCoinSeries.length ? "system" : "unavailable",
      sourceCode: "coinshares-weekly",
      sourceUrl: COINSHARES_SOURCE_URL,
      series: trustedCoinSeries,
      latestBreakdown,
    },
    marginBorrow: buildMarginBorrow(rawPressureRows as unknown as ObservationRow[]),
    liquidationMaxPain: buildLiquidationMaxPain(rawPressureRows as unknown as ObservationRow[]),
    cycleIndicators: buildCycleIndicators(rawCycleRows as unknown as ObservationRow[]),
    largeAddressActivity: buildLargeAddressActivity(
      rawLargeAddressRows as unknown as ObservationRow[],
      largeAddressSignal,
    ),
  };
}
