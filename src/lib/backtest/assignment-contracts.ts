import { z } from "zod";

import { backtestSymbolSchema } from "./contracts";
import { normalizeExecutableRule } from "@/lib/custom-strategies/contracts";
import { normalizeStrategyParameters, strategyDefinition } from "./strategy-catalog";

const builtInStrategyCodeSchema = z.enum([
  "ma_crossover",
  "turtle_breakout",
  "signal_rolling_reversal",
  "abcd_causal",
  "ema_trend",
  "rsi_mean_reversion",
  "bollinger_mean_reversion",
  "macd_momentum",
  "atr_breakout",
]);
const customStrategyCodeSchema = z.string().regex(/^custom:[0-9a-f-]{36}$/i);

const assignmentSchema = z
  .object({
    symbol: backtestSymbolSchema,
    strategyCode: z.union([builtInStrategyCodeSchema, customStrategyCodeSchema]),
    strategyVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    strategyParameters: z.record(z.string(), z.unknown()),
    backtestRunId: z.string().uuid().optional(),
    backtestRunLegId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.backtestRunId) !== Boolean(value.backtestRunLegId)) {
      context.addIssue({
        code: "custom",
        path: [value.backtestRunId ? "backtestRunLegId" : "backtestRunId"],
        message: "Backtest run and leg IDs must be provided together.",
      });
    }
    try {
      if (value.strategyCode.startsWith("custom:")) {
        normalizeExecutableRule(value.strategyParameters);
      } else {
        strategyDefinition(value.strategyCode, value.strategyVersion);
        normalizeStrategyParameters(value.strategyCode, value.strategyParameters);
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["strategyParameters"],
        message: error instanceof Error ? error.message : "Strategy parameters are invalid.",
      });
    }
  });

export type StrategyAssignmentInput = z.infer<typeof assignmentSchema>;

export function normalizeStrategyAssignment(input: unknown): StrategyAssignmentInput {
  const parsed = assignmentSchema.parse(input);
  return {
    ...parsed,
    symbol: parsed.symbol,
    strategyParameters: parsed.strategyCode.startsWith("custom:")
      ? normalizeExecutableRule(parsed.strategyParameters)
      : normalizeStrategyParameters(parsed.strategyCode, parsed.strategyParameters),
  };
}
