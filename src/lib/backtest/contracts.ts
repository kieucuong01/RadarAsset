import { z } from "zod";

import { equalAllocationBps, TOTAL_ALLOCATION_BPS } from "./allocation";
import {
  normalizeStrategyParameters,
  strategyDefinition,
  type StrategyCode,
} from "./strategy-catalog";

const DEFAULT_BACKTEST_WINDOW_DAYS = 120;
const MAX_PORTFOLIO_LEGS = 10;

function toUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function createRollingBacktestRange(now = new Date()) {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - DEFAULT_BACKTEST_WINDOW_DAYS);
  return { from: toUtcDate(from), to: toUtcDate(now) };
}

export const backtestSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._/-]{0,19}$/, "Invalid asset symbol.");

function isRealIsoDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD.")
  .refine(isRealIsoDate, "Expected a real calendar date.");

const strategyCodeSchema = z.string().trim().min(1).max(64);
const strategyVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "Expected semantic strategy version.");

export const portfolioBacktestLegSchema = z
  .object({
    symbol: backtestSymbolSchema,
    allocationBps: z.number().int().min(0).max(TOTAL_ALLOCATION_BPS),
    leverage: z.number().min(1).max(2),
    strategyCode: strategyCodeSchema,
    strategyVersion: strategyVersionSchema,
    strategyParameters: z.record(z.string(), z.unknown()),
  })
  .strict();

function validateRangeAndUniqueLegs(
  submission: { from: string; to: string; legs: Array<{ symbol: string }> },
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
    timeframe: z.enum(["1d", "1h"]),
    from: isoDateSchema,
    to: isoDateSchema,
    totalCapital: z.number().positive().max(100_000_000_000),
    allocationMode: z.enum(["equal", "custom", "optimized"]),
    feeBps: z.number().min(0).max(100),
    slippageBps: z.number().min(0).max(200),
    legs: z.array(portfolioBacktestLegSchema).min(1).max(MAX_PORTFOLIO_LEGS),
  })
  .strict()
  .superRefine((submission, context) => {
    validateRangeAndUniqueLegs(submission, context);
    if (
      submission.legs.reduce((total, leg) => total + leg.allocationBps, 0) !== TOTAL_ALLOCATION_BPS
    ) {
      context.addIssue({
        code: "custom",
        path: ["legs"],
        message: "Portfolio allocation must total exactly 10,000 basis points.",
      });
    }
    submission.legs.forEach((leg, index) => {
      try {
        strategyDefinition(leg.strategyCode, leg.strategyVersion);
        normalizeStrategyParameters(leg.strategyCode, leg.strategyParameters);
      } catch (error) {
        context.addIssue({
          code: "custom",
          path: ["legs", index, "strategyParameters"],
          message: error instanceof Error ? error.message : "Strategy parameters are invalid.",
        });
      }
    });
  });

const legacyLegSchema = z
  .object({ symbol: backtestSymbolSchema, leverage: z.number().min(1).max(2) })
  .strict();

const legacyCommonFields = {
  timeframe: z.enum(["1d", "1h"]),
  initialCapital: z.number().positive().max(100_000_000_000),
  feeBps: z.number().min(0).max(100),
  slippageBps: z.number().min(0).max(200),
  from: isoDateSchema,
  to: isoDateSchema,
  legs: z.array(legacyLegSchema).min(1).max(MAX_PORTFOLIO_LEGS),
};

const legacyCatalogSubmissionSchema = z
  .object({
    strategyCode: strategyCodeSchema,
    strategyVersion: strategyVersionSchema,
    strategyParameters: z.record(z.string(), z.unknown()),
    ...legacyCommonFields,
  })
  .strict()
  .superRefine((submission, context) => {
    validateRangeAndUniqueLegs(submission, context);
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

const legacyMaSubmissionSchema = z
  .object({
    strategy: z.literal("ma_cross"),
    fastPeriod: z.number().int().min(2).max(200),
    slowPeriod: z.number().int().min(3).max(400),
    ...legacyCommonFields,
  })
  .strict()
  .superRefine((submission, context) => {
    validateRangeAndUniqueLegs(submission, context);
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
  legacyCatalogSubmissionSchema,
  legacyMaSubmissionSchema,
]);

type CanonicalPortfolioSubmission = z.infer<typeof canonicalBacktestSubmissionSchema>;
type CanonicalPortfolioLeg = CanonicalPortfolioSubmission["legs"][number];

export type PortfolioBacktestLeg = Omit<CanonicalPortfolioLeg, "strategyCode"> & {
  strategyCode: StrategyCode;
};

export type PortfolioBacktestSubmission = Omit<CanonicalPortfolioSubmission, "legs"> & {
  legs: PortfolioBacktestLeg[];
};

/** @deprecated Use PortfolioBacktestSubmission. */
export type BacktestSubmission = PortfolioBacktestSubmission;

export function normalizeBacktestSubmission(input: unknown): PortfolioBacktestSubmission {
  const parsed = backtestSubmissionSchema.parse(input);
  let canonical: CanonicalPortfolioSubmission;

  if ("totalCapital" in parsed) {
    canonical = parsed;
  } else {
    const allocationBySymbol = equalAllocationBps(parsed.legs.map((leg) => leg.symbol));
    const sharedStrategy =
      "strategyCode" in parsed
        ? {
            strategyCode: parsed.strategyCode,
            strategyVersion: parsed.strategyVersion,
            strategyParameters: parsed.strategyParameters,
          }
        : {
            strategyCode: "ma_crossover",
            strategyVersion: "1.0.0",
            strategyParameters: {
              fastPeriod: parsed.fastPeriod,
              slowPeriod: parsed.slowPeriod,
            },
          };
    canonical = {
      timeframe: parsed.timeframe,
      from: parsed.from,
      to: parsed.to,
      totalCapital: parsed.initialCapital,
      allocationMode: "equal",
      feeBps: parsed.feeBps,
      slippageBps: parsed.slippageBps,
      legs: parsed.legs.map((leg) => ({
        ...leg,
        allocationBps: allocationBySymbol[leg.symbol],
        ...sharedStrategy,
      })),
    };
  }

  return {
    ...canonical,
    legs: canonical.legs
      .map((leg) => {
        strategyDefinition(leg.strategyCode, leg.strategyVersion);
        return {
          ...leg,
          strategyParameters: normalizeStrategyParameters(leg.strategyCode, leg.strategyParameters),
        };
      })
      .sort((left, right) => left.symbol.localeCompare(right.symbol)),
  };
}
