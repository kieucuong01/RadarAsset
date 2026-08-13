import { z } from "zod";

import { getPrisma } from "@/lib/db/prisma";
import { calculateFreshness } from "@/lib/market-data/health";

import type { TenantContext } from "@/lib/auth/tenant-context";
import type {
  MarketDataMarket,
  MarketDataTimeframe,
  QuantAssetCatalogResponse,
  QuantDataReadinessResponse,
} from "./types";

const SUPPORTED_MARKETS = ["vn_equity", "crypto_spot", "metal_spot"] as const;
const ELIGIBLE_DATASET_QUALITY = ["passed", "warning"] as const;
const CATALOG_SCAN_LIMIT = 500;
const CATALOG_RESPONSE_LIMIT = 50;
type QuantAssetReasonCode = QuantAssetCatalogResponse["items"][number]["reasonCode"];
const MARKET_PRIORITY: Record<MarketDataMarket, number> = {
  vn_equity: 0,
  metal_spot: 1,
  crypto_spot: 2,
};
const EMPTY_MARKET_COUNTS: Record<MarketDataMarket, number> = {
  vn_equity: 0,
  crypto_spot: 0,
  metal_spot: 0,
};
const BACKLOG_STATUSES = new Set(["queued", "running"]);

function isRealIsoDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealIsoDate, "Expected a real calendar date.");

export const quantAssetQuerySchema = z
  .object({
    q: z
      .string()
      .default("")
      .transform((value) => value.trim().slice(0, 40)),
    timeframe: z.enum(["1d", "1h"]),
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from > value.to) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "Start date must not be after end date.",
      });
    }
  });

export type QuantAssetQuery = z.infer<typeof quantAssetQuerySchema>;

function supportedMarket(value: string): MarketDataMarket {
  if (SUPPORTED_MARKETS.some((market) => market === value)) return value as MarketDataMarket;
  throw new Error("Unsupported Quant asset market returned from storage.");
}

function rangeBoundary(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function loadQuantAssetCatalog(
  rawQuery: QuantAssetQuery,
  now = new Date(),
): Promise<QuantAssetCatalogResponse> {
  const query = quantAssetQuerySchema.parse(rawQuery);
  const assets = await getPrisma().asset.findMany({
    where: {
      market: { in: [...SUPPORTED_MARKETS] },
      ...(query.q
        ? {
            OR: [
              { symbol: { contains: query.q, mode: "insensitive" as const } },
              { name: { startsWith: query.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { symbol: "asc" },
    take: CATALOG_SCAN_LIMIT,
    select: {
      symbol: true,
      name: true,
      market: true,
      venue: true,
      currency: true,
      maxLeverage: true,
      datasets: {
        where: { timeframe: query.timeframe, adjustmentPolicy: "raw" },
        take: 1,
        select: {
          versions: {
            where: { isActive: true, qualityStatus: { in: [...ELIGIBLE_DATASET_QUALITY] } },
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              coverageStart: true,
              coverageEnd: true,
              rowCount: true,
              bars: {
                orderBy: { ts: "desc" },
                take: 1,
                select: { source: true },
              },
            },
          },
        },
      },
    },
  });

  const requestedStart = rangeBoundary(query.from);
  const requestedEnd = rangeBoundary(query.to);

  return {
    items: assets
      .map((asset) => {
        const market = supportedMarket(asset.market);
        const version = asset.datasets[0]?.versions[0] ?? null;
        const rangeCovered = Boolean(
          version && version.coverageStart <= requestedStart && version.coverageEnd >= requestedEnd,
        );
        const reasonCode: QuantAssetReasonCode = !version
          ? "DATASET_UNAVAILABLE"
          : !rangeCovered
            ? "DATASET_RANGE_INSUFFICIENT"
            : null;

        return {
          symbol: asset.symbol,
          name: asset.name,
          market,
          venue: asset.venue,
          currency: asset.currency,
          maxLeverage: Number(asset.maxLeverage),
          timeframe: query.timeframe as MarketDataTimeframe,
          datasetVersionId: version?.id ?? null,
          coverageStart: version?.coverageStart.toISOString() ?? null,
          coverageEnd: version?.coverageEnd.toISOString() ?? null,
          rowCount: version?.rowCount ?? 0,
          freshness: calculateFreshness({
            market,
            timeframe: query.timeframe,
            coverageEnd: version?.coverageEnd ?? null,
            source: version?.bars[0]?.source ?? null,
            lastStatus: null,
            now,
          }),
          backtestable: reasonCode === null,
          reasonCode,
        };
      })
      .sort((left, right) => {
        const readiness = Number(right.backtestable) - Number(left.backtestable);
        if (readiness !== 0) return readiness;
        const market = MARKET_PRIORITY[left.market] - MARKET_PRIORITY[right.market];
        if (market !== 0) return market;
        const rows = right.rowCount - left.rowCount;
        if (rows !== 0) return rows;
        return left.symbol.localeCompare(right.symbol);
      })
      .slice(0, CATALOG_RESPONSE_LIMIT),
  };
}

export async function loadQuantDataReadiness(
  context: TenantContext,
): Promise<QuantDataReadinessResponse> {
  const prisma = getPrisma();
  const [assetCounts, activeDatasets, ingestionCounts] = await Promise.all([
    prisma.asset.groupBy({
      by: ["market"],
      where: { market: { in: [...SUPPORTED_MARKETS] } },
      _count: { _all: true },
    }),
    prisma.dataset.findMany({
      where: {
        adjustmentPolicy: "raw",
        timeframe: { in: ["1d", "1h"] },
        asset: { market: { in: [...SUPPORTED_MARKETS] } },
        versions: {
          some: { isActive: true, qualityStatus: { in: [...ELIGIBLE_DATASET_QUALITY] } },
        },
      },
      select: {
        timeframe: true,
        asset: { select: { market: true } },
      },
    }),
    prisma.marketIngestionRequest.groupBy({
      by: ["status", "timeframe"],
      where: { organizationId: context.organizationId },
      _count: { _all: true },
    }),
  ]);

  const instrumentsByMarket = { ...EMPTY_MARKET_COUNTS };
  for (const row of assetCounts) {
    instrumentsByMarket[supportedMarket(row.market)] = row._count._all;
  }

  const activeDatasetMap = new Map<string, QuantDataReadinessResponse["activeDatasetsByMarketTimeframe"][number]>();
  for (const dataset of activeDatasets) {
    const market = supportedMarket(dataset.asset.market);
    const timeframe = dataset.timeframe as MarketDataTimeframe;
    const key = `${market}:${timeframe}`;
    const current = activeDatasetMap.get(key);
    if (current) {
      current.count += 1;
    } else {
      activeDatasetMap.set(key, { market, timeframe, count: 1 });
    }
  }
  const activeDatasetsByMarketTimeframe = [...activeDatasetMap.values()].sort((left, right) => {
    const market = MARKET_PRIORITY[left.market] - MARKET_PRIORITY[right.market];
    if (market !== 0) return market;
    return left.timeframe.localeCompare(right.timeframe);
  });

  const ingestionRequestsByStatusTimeframe = ingestionCounts.map((row) => ({
    status: row.status,
    timeframe: row.timeframe as MarketDataTimeframe,
    count: row._count._all,
  }));
  const backlogCount = ingestionRequestsByStatusTimeframe
    .filter((row) => BACKLOG_STATUSES.has(row.status))
    .reduce((total, row) => total + row.count, 0);

  return {
    readyForBacktest: activeDatasetsByMarketTimeframe.some((row) => row.count > 0),
    instrumentsByMarket,
    activeDatasetsByMarketTimeframe,
    ingestionRequestsByStatusTimeframe,
    backlogCount,
  };
}
