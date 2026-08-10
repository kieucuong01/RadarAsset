import { createHash } from "node:crypto";

import { z } from "zod";

export const backtestAssetSchema = z.enum(["FPT", "BTC", "XAU"]);
export type BacktestAsset = z.infer<typeof backtestAssetSchema>;

export function maximumLeverageForAsset(asset: BacktestAsset) {
  return asset === "FPT" ? 2 : 1;
}

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD.");

const backtestLegSchema = z
  .object({
    symbol: backtestAssetSchema,
    leverage: z.number().min(1),
  })
  .strict()
  .superRefine((leg, context) => {
    if (leg.leverage > maximumLeverageForAsset(leg.symbol)) {
      context.addIssue({
        code: "custom",
        path: ["leverage"],
        message: `${leg.symbol} leverage exceeds its product limit.`,
      });
    }
  });

export const backtestSubmissionSchema = z
  .object({
    strategy: z.literal("ma_cross"),
    timeframe: z.enum(["1d", "1h"]),
    fastPeriod: z.number().int().min(2).max(200),
    slowPeriod: z.number().int().min(3).max(400),
    initialCapital: z.number().positive().max(100_000_000_000),
    feeBps: z.number().min(0).max(100),
    slippageBps: z.number().min(0).max(200),
    from: isoDateSchema,
    to: isoDateSchema,
    legs: z.array(backtestLegSchema).min(1).max(3),
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.fastPeriod >= submission.slowPeriod) {
      context.addIssue({
        code: "custom",
        path: ["fastPeriod"],
        message: "Fast period must be lower than slow period.",
      });
    }
    if (submission.from > submission.to) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "Start date must not be after end date.",
      });
    }
    const symbols = submission.legs.map((leg) => leg.symbol);
    if (new Set(symbols).size !== symbols.length) {
      context.addIssue({
        code: "custom",
        path: ["legs"],
        message: "Each asset may appear only once.",
      });
    }
  });

export type BacktestSubmission = z.infer<typeof backtestSubmissionSchema>;

export function normalizeBacktestSubmission(input: unknown): BacktestSubmission {
  const parsed = backtestSubmissionSchema.parse(input);
  return {
    strategy: parsed.strategy,
    timeframe: parsed.timeframe,
    fastPeriod: parsed.fastPeriod,
    slowPeriod: parsed.slowPeriod,
    initialCapital: parsed.initialCapital,
    feeBps: parsed.feeBps,
    slippageBps: parsed.slippageBps,
    from: parsed.from,
    to: parsed.to,
    legs: [...parsed.legs].sort((left, right) => left.symbol.localeCompare(right.symbol)),
  };
}

export function hashBacktestSubmission(input: BacktestSubmission) {
  const normalized = normalizeBacktestSubmission(input);
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}
