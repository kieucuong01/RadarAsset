import { z } from "zod";

import { backtestSymbolSchema } from "./contracts";
import { OPTIMIZER_METHODS } from "./optimizer-methods";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const optimizerRequestSchema = z
  .object({
    symbols: z.array(backtestSymbolSchema).min(1).max(10),
    method: z.enum(OPTIMIZER_METHODS),
    timeframe: z.enum(["1d"]),
    from: z.string(),
    to: z.string(),
    maxWeightBps: z.number().int().min(1).max(10_000),
    totalWeightBps: z.number().int().min(1).max(10_000),
    targetReturnPct: z.number().finite().min(-100).max(1_000).optional(),
    targetVolatilityPct: z.number().finite().positive().max(1_000).optional(),
    riskTolerance: z.number().finite().positive().max(1_000_000).optional(),
    dividendMode: z.enum(["exclude", "adjusted_prices"]),
  })
  .strict();

const optimizerAssetMetricSchema = z
  .object({
    symbol: backtestSymbolSchema,
    expectedReturnPct: z.number().finite(),
    volatilityPct: z.number().finite().nonnegative(),
  })
  .strict();

const optimizerCorrelationRowSchema = z
  .object({
    symbol: backtestSymbolSchema,
    correlations: z.record(backtestSymbolSchema, z.number().finite().min(-1).max(1)),
  })
  .strict();

function sortedKeys(input: Record<string, unknown>) {
  return Object.keys(input).sort();
}

function sameSymbols(left: string[], right: string[]) {
  return [...left].sort().join("|") === [...right].sort().join("|");
}

const optimizerProposalSchema = z
  .object({
    method: z.enum(OPTIMIZER_METHODS),
    source: z
      .object({
        library: z.string().min(1),
        version: z.string().min(1),
        repository: z.string().url(),
        directory: z.string().min(1),
        license: z.string().min(1),
      })
      .strict(),
    weightsBps: z.record(backtestSymbolSchema, z.number().int().min(0).max(10_000)),
    totalWeightBps: z.number().int().min(1).max(10_000),
    expectedReturnPct: z.number().finite(),
    volatilityPct: z.number().finite().nonnegative(),
    sharpe: z.number().finite().nullable(),
    observationCount: z.number().int().min(30),
    assetMetrics: z.array(optimizerAssetMetricSchema).min(1).max(10),
    correlationMatrix: z.array(optimizerCorrelationRowSchema).min(1).max(10),
    validation: z
      .object({
        split: z.literal("chronological_70_30"),
        trainObservationCount: z.number().int().min(29),
        testObservationCount: z.number().int().min(1),
        inSample: z
          .object({
            expectedReturnPct: z.number().finite(),
            volatilityPct: z.number().finite().nonnegative(),
            sharpe: z.number().finite().nullable(),
            maxDrawdownPct: z.number().finite().nonpositive(),
          })
          .strict(),
        outOfSample: z
          .object({
            expectedReturnPct: z.number().finite(),
            volatilityPct: z.number().finite().nonnegative(),
            sharpe: z.number().finite().nullable(),
            maxDrawdownPct: z.number().finite().nonpositive(),
          })
          .strict(),
      })
      .strict(),
    datasetVersionIds: z.record(backtestSymbolSchema, z.string().min(1)),
    warnings: z.array(z.string()),
  })
  .strict()
  .superRefine((proposal, context) => {
    const total = Object.values(proposal.weightsBps).reduce((sum, value) => sum + value, 0);
    if (total !== proposal.totalWeightBps) {
      context.addIssue({
        code: "custom",
        path: ["weightsBps"],
        message: "Optimized weights do not match the investable target.",
      });
    }
    const weightSymbols = Object.keys(proposal.weightsBps).sort();
    const datasetSymbols = Object.keys(proposal.datasetVersionIds).sort();
    if (!sameSymbols(weightSymbols, datasetSymbols)) {
      context.addIssue({
        code: "custom",
        path: ["datasetVersionIds"],
        message: "Optimizer datasets do not match the proposed symbols.",
      });
    }
    const metricSymbols = proposal.assetMetrics.map((metric) => metric.symbol);
    if (!sameSymbols(weightSymbols, metricSymbols)) {
      context.addIssue({
        code: "custom",
        path: ["assetMetrics"],
        message: "Optimizer asset metrics do not match the proposed symbols.",
      });
    }
    const matrixSymbols = proposal.correlationMatrix.map((row) => row.symbol);
    if (!sameSymbols(weightSymbols, matrixSymbols)) {
      context.addIssue({
        code: "custom",
        path: ["correlationMatrix"],
        message: "Optimizer correlation matrix does not match the proposed symbols.",
      });
    }
    for (const row of proposal.correlationMatrix) {
      if (!sameSymbols(weightSymbols, sortedKeys(row.correlations))) {
        context.addIssue({
          code: "custom",
          path: ["correlationMatrix", row.symbol, "correlations"],
          message: "Optimizer correlation row does not match the proposed symbols.",
        });
      }
      if (Math.abs((row.correlations[row.symbol] ?? 0) - 1) > 0.0001) {
        context.addIssue({
          code: "custom",
          path: ["correlationMatrix", row.symbol, row.symbol],
          message: "Optimizer correlation matrix diagonal must equal 1.",
        });
      }
    }
  });

export type OptimizerRequest = z.infer<typeof optimizerRequestSchema>;
export type OptimizerProposal = z.infer<typeof optimizerProposalSchema>;

export function parseOptimizerProposal(input: unknown): OptimizerProposal {
  const parsed = optimizerProposalSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid optimizer response.");
  return parsed.data;
}

export async function requestOptimizedAllocation(
  rawRequest: OptimizerRequest,
  fetcher: Fetcher = fetch,
) {
  const request = optimizerRequestSchema.parse(rawRequest);
  const response = await fetcher("/api/quant/allocations/optimize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error("Allocation optimizer is unavailable.");
  return parseOptimizerProposal(await response.json());
}
