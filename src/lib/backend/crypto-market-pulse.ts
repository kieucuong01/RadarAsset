import type { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db/prisma";

const ALTERNATIVE_SOURCE_URL = "https://alternative.me/crypto/fear-and-greed-index/";
const COINSHARES_SOURCE_URL = "https://coinshares.com/corp/resources/market-activity/";
const FARSIDE_PROVIDERS = ["farside-btc-etf", "farside-eth-etf", "farside-sol-etf"] as const;
const ACCEPTED_QUALITY = ["passed", "warning"];
const DAY_MS = 86_400_000;

type AssetCode = "BTC" | "ETH" | "SOL";

type ObservationRow = {
  naturalKey: string;
  effectiveAt: Date;
  value: { toString(): string };
  revision: number;
  dimensions: Prisma.JsonValue;
  provider?: { code: string };
  rawSnapshot?: { sourceUrl: string };
};

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
};

export function classifyFearGreed(value: number): string {
  if (value <= 24) return "Extreme Fear";
  if (value <= 44) return "Fear";
  if (value <= 54) return "Neutral";
  if (value <= 74) return "Greed";
  return "Extreme Greed";
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

export async function loadCryptoMarketPulse(now = new Date()): Promise<CryptoMarketPulseResponse> {
  const prisma = getPrisma();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const [rawFearRows, rawEtfRows, rawCoinSharesRows] = await Promise.all([
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
  };
}
