import { createHash } from "node:crypto";

import { z } from "zod";

import {
  normalizeStrategyParameters,
  strategyDefinition,
  type StrategyCode,
} from "./strategy-catalog";

const DEFAULT_BACKTEST_WINDOW_DAYS = 120;

function toUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function createRollingBacktestRange(now = new Date()) {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - DEFAULT_BACKTEST_WINDOW_DAYS);

  return {
    from: toUtcDate(from),
    to: toUtcDate(now),
  };
}

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

const commonSubmissionFields = {
  timeframe: z.enum(["1d", "1h"]),
  initialCapital: z.number().positive().max(100_000_000_000),
  feeBps: z.number().min(0).max(100),
  slippageBps: z.number().min(0).max(200),
  from: isoDateSchema,
  to: isoDateSchema,
  legs: z.array(backtestLegSchema).min(1).max(3),
};

function validateCommonSubmission(
  submission: { from: string; to: string; legs: Array<{ symbol: BacktestAsset }> },
  context: z.RefinementCtx,
) {
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
}

export const canonicalBacktestSubmissionSchema = z
  .object({
    strategyCode: z.enum([
      "ma_crossover",
      "turtle_breakout",
      "signal_rolling_reversal",
      "abcd_causal",
    ]),
    strategyVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "Expected semantic strategy version."),
    strategyParameters: z.record(z.string(), z.unknown()),
    ...commonSubmissionFields,
  })
  .strict()
  .superRefine((submission, context) => {
    validateCommonSubmission(submission, context);
    try {
      strategyDefinition(submission.strategyCode, submission.strategyVersion);
      normalizeStrategyParameters(submission.strategyCode, submission.strategyParameters);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["strategyParameters"],
        message: error instanceof Error ? error.message : "Strategy parameters are invalid.",
      });
    }
  });

const legacyBacktestSubmissionSchema = z
  .object({
    strategy: z.literal("ma_cross"),
    fastPeriod: z.number().int().min(2).max(200),
    slowPeriod: z.number().int().min(3).max(400),
    ...commonSubmissionFields,
  })
  .strict()
  .superRefine((submission, context) => {
    validateCommonSubmission(submission, context);
    if (submission.fastPeriod >= submission.slowPeriod) {
      context.addIssue({
        code: "custom",
        path: ["fastPeriod"],
        message: "Fast period must be lower than slow period.",
      });
    }
  });

export const backtestSubmissionSchema = z.union([
  canonicalBacktestSubmissionSchema,
  legacyBacktestSubmissionSchema,
]);

type CanonicalBacktestSubmission = z.infer<typeof canonicalBacktestSubmissionSchema>;
export type BacktestSubmission = Omit<CanonicalBacktestSubmission, "strategyCode"> & {
  strategyCode: StrategyCode;
};

export function normalizeBacktestSubmission(input: unknown): BacktestSubmission {
  const parsed = backtestSubmissionSchema.parse(input);
  const canonical: CanonicalBacktestSubmission =
    "strategyCode" in parsed
      ? parsed
      : {
          strategyCode: "ma_crossover",
          strategyVersion: "1.0.0",
          strategyParameters: {
            fastPeriod: parsed.fastPeriod,
            slowPeriod: parsed.slowPeriod,
          },
          timeframe: parsed.timeframe,
          initialCapital: parsed.initialCapital,
          feeBps: parsed.feeBps,
          slippageBps: parsed.slippageBps,
          from: parsed.from,
          to: parsed.to,
          legs: parsed.legs,
        };
  strategyDefinition(canonical.strategyCode, canonical.strategyVersion);
  return {
    ...canonical,
    strategyParameters: normalizeStrategyParameters(
      canonical.strategyCode,
      canonical.strategyParameters,
    ),
    legs: [...canonical.legs].sort((left, right) => left.symbol.localeCompare(right.symbol)),
  };
}

export function hashBacktestSubmission(input: BacktestSubmission) {
  const normalized = normalizeBacktestSubmission(input);
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}
