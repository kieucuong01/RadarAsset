import { z } from "zod";

import { normalizeStrategyParameters, strategyDefinition } from "./strategy-catalog";

const assignmentSchema = z
  .object({
    symbol: z
      .string()
      .transform((value) => value.toUpperCase())
      .pipe(z.enum(["FPT", "BTC", "XAU"])),
    strategyCode: z.enum([
      "ma_crossover",
      "turtle_breakout",
      "signal_rolling_reversal",
      "abcd_causal",
    ]),
    strategyVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    strategyParameters: z.record(z.string(), z.unknown()),
    backtestRunId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    try {
      strategyDefinition(value.strategyCode, value.strategyVersion);
      normalizeStrategyParameters(value.strategyCode, value.strategyParameters);
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
    strategyParameters: normalizeStrategyParameters(parsed.strategyCode, parsed.strategyParameters),
  };
}
