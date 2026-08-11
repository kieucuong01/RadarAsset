import { z } from "zod";

import { getPrisma } from "@/lib/db/prisma";
import { calculateFreshness } from "@/lib/market-data/health";

import type { MarketDataMarket, MarketDataTimeframe, QuantAssetCatalogResponse } from "./types";

const SUPPORTED_MARKETS = ["vn_equity", "crypto_spot", "metal_spot"] as const;

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
              { name: { contains: query.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { symbol: "asc" },
    take: 50,
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
            where: { isActive: true, qualityStatus: "passed" },
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
    items: assets.map((asset) => {
      const market = supportedMarket(asset.market);
      const version = asset.datasets[0]?.versions[0] ?? null;
      const rangeCovered = Boolean(
        version && version.coverageStart <= requestedStart && version.coverageEnd >= requestedEnd,
      );
      const reasonCode = !version
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
    }),
  };
}
