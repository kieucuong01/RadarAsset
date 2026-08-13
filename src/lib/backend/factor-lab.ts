import { z } from "zod";

import type { TenantContext } from "@/lib/auth/tenant-context";
import { getPrisma } from "@/lib/db/prisma";
import { requestQuantEngineVietnamFactors } from "./quant-engine-client";

const factorResultSchema = z
  .object({
    asOf: z.string(),
    universeSize: z.number().int().min(5),
    observationCount: z.number().int().min(252),
    methodology: z.literal("point_in_time_price_volume_v1"),
    rows: z.array(
      z
        .object({
          symbol: z.string(),
          compositeScore: z.number().min(0).max(100),
          momentumScore: z.number().min(0).max(100),
          lowVolatilityScore: z.number().min(0).max(100),
          trendScore: z.number().min(0).max(100),
          liquidityScore: z.number().min(0).max(100),
          momentum126dPct: z.number(),
          volatility63dPct: z.number().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

function numberValue(value: unknown) {
  const result = Number(
    value && typeof value === "object" && "toString" in value ? value.toString() : value,
  );
  if (!Number.isFinite(result)) throw new Error("Factor dataset contains an invalid number.");
  return result;
}

export async function loadVietnamFactorLab(_context: TenantContext) {
  const assets = await getPrisma().asset.findMany({
    where: { market: "vn_equity" },
    orderBy: { symbol: "asc" },
    select: {
      symbol: true,
      datasets: {
        where: { timeframe: "1d", adjustmentPolicy: "raw" },
        take: 1,
        select: {
          versions: {
            where: { isActive: true, qualityStatus: { in: ["passed", "warning"] } },
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              bars: {
                orderBy: { ts: "desc" },
                take: 320,
                select: { ts: true, close: true, volume: true },
              },
            },
          },
        },
      },
    },
  });
  const eligible = assets.flatMap((asset) => {
    const version = asset.datasets[0]?.versions[0];
    if (!version || version.bars.length < 252 || version.bars.some((bar) => bar.volume === null))
      return [];
    return [{ symbol: asset.symbol, version }];
  });
  if (eligible.length < 5) {
    return {
      ready: false as const,
      reasonCode: "insufficient_symbols" as const,
      eligibleAssetCount: eligible.length,
      requiredAssetCount: 5,
      requiredObservationCount: 252,
    };
  }
  const maps = Object.fromEntries(
    eligible.map(({ symbol, version }) => [
      symbol,
      new Map(version.bars.map((bar) => [bar.ts.valueOf(), bar])),
    ]),
  );
  const symbols = eligible.map((item) => item.symbol);
  const timestamps = [...maps[symbols[0]].keys()]
    .filter((timestamp) => symbols.every((symbol) => maps[symbol].has(timestamp)))
    .sort((left, right) => left - right)
    .slice(-320);
  if (timestamps.length < 252) {
    return {
      ready: false as const,
      reasonCode: "insufficient_aligned_sessions" as const,
      eligibleAssetCount: eligible.length,
      requiredAssetCount: 5,
      requiredObservationCount: 252,
    };
  }
  const pricesBySymbol = Object.fromEntries(
    symbols.map((symbol) => [
      symbol,
      timestamps.map((timestamp) => numberValue(maps[symbol].get(timestamp)!.close)),
    ]),
  );
  const volumesBySymbol = Object.fromEntries(
    symbols.map((symbol) => [
      symbol,
      timestamps.map((timestamp) => numberValue(maps[symbol].get(timestamp)!.volume)),
    ]),
  );
  const result = await requestQuantEngineVietnamFactors({
    pricesBySymbol,
    volumesBySymbol,
    asOf: new Date(timestamps.at(-1)!).toISOString().slice(0, 10),
  });
  return {
    ready: true as const,
    datasetVersionIds: Object.fromEntries(
      eligible.map(({ symbol, version }) => [symbol, version.id]),
    ),
    ...factorResultSchema.parse(result),
  };
}
