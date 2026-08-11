import { z } from "zod";

import type { TenantContext } from "@/lib/auth/tenant-context";
import { backtestSymbolSchema } from "@/lib/backtest/contracts";
import { optimizeMeanVariance } from "@/lib/backtest/optimizer";
import { getPrisma } from "@/lib/db/prisma";

function realIsoDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(realIsoDate, "Expected a real calendar date.");

export const quantOptimizerRequestSchema = z
  .object({
    symbols: z.array(backtestSymbolSchema).min(1).max(10),
    timeframe: z.enum(["1d", "1h"]),
    from: isoDateSchema,
    to: isoDateSchema,
    riskAversion: z.number().min(1).max(10),
    maxWeightBps: z.number().int().min(1).max(10_000),
    totalWeightBps: z.number().int().min(1).max(10_000),
    dividendMode: z.enum(["exclude", "adjusted_prices"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.symbols).size !== value.symbols.length) {
      context.addIssue({ code: "custom", path: ["symbols"], message: "Symbols must be unique." });
    }
    if (value.from > value.to) {
      context.addIssue({ code: "custom", path: ["from"], message: "Invalid date range." });
    }
    const durationDays =
      (new Date(`${value.to}T00:00:00.000Z`).valueOf() -
        new Date(`${value.from}T00:00:00.000Z`).valueOf()) /
      86_400_000;
    const maximumDays = value.timeframe === "1h" ? 730 : 3_650;
    if (durationDays > maximumDays) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: `Optimizer range exceeds ${maximumDays} days.`,
      });
    }
    if (value.maxWeightBps * value.symbols.length < value.totalWeightBps) {
      context.addIssue({
        code: "custom",
        path: ["maxWeightBps"],
        message: "Maximum weight cannot satisfy the investable target.",
      });
    }
  });

export type QuantOptimizerRequest = z.infer<typeof quantOptimizerRequestSchema>;

type OptimizerEligibilityCode =
  | "DATASET_UNAVAILABLE"
  | "DATASET_RANGE_INSUFFICIENT"
  | "INSUFFICIENT_OVERLAP";

export class QuantOptimizerEligibilityError extends Error {
  constructor(
    readonly code: OptimizerEligibilityCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "QuantOptimizerEligibilityError";
  }
}

function dateBoundary(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function closeNumber(value: unknown) {
  const close =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : value && typeof value === "object" && "toString" in value
          ? Number(value.toString())
          : Number.NaN;
  if (!Number.isFinite(close) || close <= 0) throw new Error("Dataset contains an invalid close.");
  return close;
}

export async function optimizeQuantAllocation(
  context: TenantContext,
  rawInput: QuantOptimizerRequest,
) {
  void context.organizationId;
  const input = quantOptimizerRequestSchema.parse(rawInput);
  const symbols = [...input.symbols].sort();
  const from = dateBoundary(input.from);
  const to = dateBoundary(input.to);
  const adjustmentPolicy = input.dividendMode === "adjusted_prices" ? "total_return" : "raw";
  const assets = await getPrisma().asset.findMany({
    where: { symbol: { in: symbols } },
    orderBy: { symbol: "asc" },
    select: {
      symbol: true,
      datasets: {
        where: { timeframe: input.timeframe, adjustmentPolicy },
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
              bars: {
                where: { ts: { gte: from, lte: to } },
                orderBy: { ts: "asc" },
                select: { ts: true, close: true },
              },
            },
          },
        },
      },
    },
  });
  const assetBySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));
  const pricesBySymbol: Record<string, Map<number, number>> = {};
  const datasetVersionIds: Record<string, string> = {};
  for (const symbol of symbols) {
    const version = assetBySymbol.get(symbol)?.datasets[0]?.versions[0];
    if (!version) {
      throw new QuantOptimizerEligibilityError(
        "DATASET_UNAVAILABLE",
        `${symbol} has no eligible ${adjustmentPolicy} dataset.`,
      );
    }
    if (version.coverageStart > from || version.coverageEnd < to) {
      throw new QuantOptimizerEligibilityError(
        "DATASET_RANGE_INSUFFICIENT",
        `${symbol} does not cover the requested range.`,
      );
    }
    datasetVersionIds[symbol] = version.id;
    pricesBySymbol[symbol] = new Map(
      version.bars.map((bar) => [bar.ts.valueOf(), closeNumber(bar.close)]),
    );
  }

  const sharedTimestamps = [...(pricesBySymbol[symbols[0]]?.keys() ?? [])].filter((timestamp) =>
    symbols.every((symbol) => pricesBySymbol[symbol].has(timestamp)),
  );
  if (sharedTimestamps.length < 31) {
    throw new QuantOptimizerEligibilityError(
      "INSUFFICIENT_OVERLAP",
      "At least 31 aligned prices are required.",
    );
  }
  const returnsBySymbol = Object.fromEntries(
    symbols.map((symbol) => {
      const prices = sharedTimestamps.map((timestamp) => pricesBySymbol[symbol].get(timestamp)!);
      return [symbol, prices.slice(1).map((price, index) => price / prices[index] - 1)];
    }),
  );
  const optimized = optimizeMeanVariance({
    returnsBySymbol,
    riskAversion: input.riskAversion,
    maxWeightBps: input.maxWeightBps,
    totalWeightBps: input.totalWeightBps,
    periodsPerYear: input.timeframe === "1d" ? 252 : 1_512,
  });
  return { ...optimized, totalWeightBps: input.totalWeightBps, datasetVersionIds };
}
