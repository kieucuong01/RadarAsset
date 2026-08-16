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
  const completedDay = new Date(now);
  completedDay.setUTCDate(completedDay.getUTCDate() - 1);
  const from = new Date(completedDay);
  from.setUTCDate(from.getUTCDate() - DEFAULT_BACKTEST_WINDOW_DAYS);
  return { from: toUtcDate(from), to: toUtcDate(completedDay) };
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

const customStrategyCodePattern =
  /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const strategyCodeSchema = z.string().trim().min(1).max(64);
const strategyVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "Expected semantic strategy version.");

const marketCostSchema = z
  .object({
    commissionBps: z.number().min(0).max(1000),
    sellTaxBps: z.number().min(0).max(1000),
    slippageBps: z.number().min(0).max(2000),
    financingBpsAnnual: z.number().min(0).max(10_000),
  })
  .strict();

export const portfolioAssumptionsSchema = z
  .object({
    cashAllocationBps: z.number().int().min(0).max(TOTAL_ALLOCATION_BPS),
    rebalanceFrequency: z.enum(["none", "monthly", "quarterly", "yearly"]),
    monthlyContribution: z.number().min(0).max(100_000_000_000),
    dividendMode: z.enum(["exclude", "adjusted_prices"]),
    fxPolicy: z.literal("normalized_returns"),
    baseCurrency: z.enum(["USD", "VND"]),
    marketCosts: z
      .object({
        vn_equity: marketCostSchema,
        crypto_spot: marketCostSchema,
        metal_spot: marketCostSchema,
      })
      .strict(),
  })
  .strict();

export type PortfolioAssumptions = z.infer<typeof portfolioAssumptionsSchema>;

export function createDefaultPortfolioAssumptions(
  feeBps: number,
  slippageBps: number,
): PortfolioAssumptions {
  const cost = {
    commissionBps: feeBps,
    sellTaxBps: 0,
    slippageBps,
    financingBpsAnnual: 0,
  };
  return {
    cashAllocationBps: 0,
    rebalanceFrequency: "none",
    monthlyContribution: 0,
    dividendMode: "exclude",
    fxPolicy: "normalized_returns",
    baseCurrency: "USD",
    marketCosts: {
      vn_equity: { ...cost },
      crypto_spot: { ...cost },
      metal_spot: { ...cost },
    },
  };
}

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

function isCustomStrategyCode(code: string) {
  return customStrategyCodePattern.test(code);
}

function normalizeLegStrategyParameters(code: string, input: unknown) {
  if (!isCustomStrategyCode(code)) return normalizeStrategyParameters(code, input);
  const parameters = z.record(z.string(), z.unknown()).parse(input);
  if (Object.keys(parameters).length > 0) {
    throw new Error("Custom strategy parameters are frozen by its immutable version.");
  }
  return {};
}

function validateLegStrategy(code: string, version: string, parameters: unknown) {
  if (!isCustomStrategyCode(code)) strategyDefinition(code, version);
  return normalizeLegStrategyParameters(code, parameters);
}

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
    timeframe: z.enum(["1d"]),
    from: isoDateSchema,
    to: isoDateSchema,
    totalCapital: z.number().positive().max(100_000_000_000),
    allocationMode: z.enum(["equal", "custom", "optimized"]),
    feeBps: z.number().min(0).max(100),
    slippageBps: z.number().min(0).max(200),
    assumptions: portfolioAssumptionsSchema.optional(),
    legs: z.array(portfolioBacktestLegSchema).min(1).max(MAX_PORTFOLIO_LEGS),
  })
  .strict()
  .superRefine((submission, context) => {
    validateRangeAndUniqueLegs(submission, context);
    if (
      submission.legs.reduce((total, leg) => total + leg.allocationBps, 0) +
        (submission.assumptions?.cashAllocationBps ?? 0) !==
      TOTAL_ALLOCATION_BPS
    ) {
      context.addIssue({
        code: "custom",
        path: ["legs"],
        message: "Portfolio allocation must total exactly 10,000 basis points.",
      });
    }
    submission.legs.forEach((leg, index) => {
      try {
        validateLegStrategy(leg.strategyCode, leg.strategyVersion, leg.strategyParameters);
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
  timeframe: z.enum(["1d"]),
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
      validateLegStrategy(
        submission.strategyCode,
        submission.strategyVersion,
        submission.strategyParameters,
      );
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
  strategyCode: StrategyCode | `custom:${string}`;
};

export type PortfolioBacktestSubmission = Omit<
  CanonicalPortfolioSubmission,
  "legs" | "assumptions"
> & {
  assumptions: PortfolioAssumptions;
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
      assumptions: createDefaultPortfolioAssumptions(parsed.feeBps, parsed.slippageBps),
      legs: parsed.legs.map((leg) => ({
        ...leg,
        allocationBps: allocationBySymbol[leg.symbol],
        ...sharedStrategy,
      })),
    };
  }

  return {
    ...canonical,
    assumptions:
      canonical.assumptions ??
      createDefaultPortfolioAssumptions(canonical.feeBps, canonical.slippageBps),
    legs: canonical.legs
      .map((leg) => {
        return {
          ...leg,
          strategyParameters: normalizeLegStrategyParameters(
            leg.strategyCode,
            leg.strategyParameters,
          ),
        };
      })
      .sort((left, right) => left.symbol.localeCompare(right.symbol)),
  };
}
