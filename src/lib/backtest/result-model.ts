import { z } from "zod";

import type { BacktestArtifact, BacktestRun } from "./client";

const contributionPointSchema = z
  .object({
    timestamp: z.string().datetime({ offset: true }),
    equity: z.number(),
    components: z.record(z.string(), z.number()),
  })
  .strict();

const cashFlowPointSchema = z
  .object({
    timestamp: z.string().datetime({ offset: true }),
    type: z.literal("contribution"),
    amount: z.number().nonnegative(),
    cashAmount: z.number().nonnegative(),
  })
  .strict();

const rebalancePointSchema = z
  .object({
    timestamp: z.string().datetime({ offset: true }),
    frequency: z.enum(["monthly", "quarterly", "yearly"]),
    turnover: z.number().nonnegative(),
    cost: z.number().nonnegative(),
    transfers: z.record(z.string(), z.number()),
  })
  .strict();

const robustnessFoldSchema = z
  .object({
    fold: z.number().int().positive(),
    trainStart: z.string(),
    trainEnd: z.string(),
    testStart: z.string(),
    testEnd: z.string(),
    trainObservationCount: z.number().int().positive(),
    testObservationCount: z.number().int().positive(),
    referenceReturnPct: z.number(),
    outOfSampleReturnPct: z.number(),
    degradationPctPoints: z.number(),
    selectedCandidate: z.string().min(1).optional(),
  })
  .strict();

const parameterStabilitySchema = z
  .object({
    status: z.enum(["stable", "mixed", "fragile", "not_evaluated"]),
    score: z.number().min(0).max(100).nullable(),
    neighborCount: z.number().int().nonnegative().optional(),
    warnings: z.array(z.string()),
  })
  .strict();

const robustnessSchema = z
  .object({
    method: z.enum(["anchored_temporal_holdout", "anchored_walk_forward_selection"]),
    candidateCount: z.number().int().positive().optional(),
    foldCount: z.number().int().min(2).max(10),
    folds: z.array(robustnessFoldSchema).min(2),
    outOfSampleMeanReturnPct: z.number(),
    outOfSampleReturnStdPct: z.number().nonnegative(),
    outOfSamplePositiveFoldPct: z.number().min(0).max(100),
    sampleAdequacy: z.enum(["adequate", "insufficient"]),
    warnings: z.array(z.string()),
    disclaimer: z.string().min(1),
    parameterStability: parameterStabilitySchema,
    overallStatus: z.enum(["stable", "mixed", "fragile", "not_evaluated"]).optional(),
  })
  .strict();

const displayedAssumptionsSchema = z
  .object({
    cashAllocationBps: z.number().int().min(0).max(10_000),
    rebalanceFrequency: z.enum(["none", "monthly", "quarterly", "yearly"]),
    monthlyContribution: z.number().nonnegative(),
    dividendMode: z.enum(["exclude", "adjusted_prices"]),
    fxPolicy: z.literal("normalized_returns"),
    baseCurrency: z.enum(["USD", "VND"]),
  })
  .passthrough();

const aggregateManifestSchema = z
  .object({
    engineVersion: z.literal("portfolio-v1"),
    assumptions: displayedAssumptionsSchema,
    historicalCoverage: z
      .object({
        firstObservedAt: z.string().datetime().nullable(),
        completeForRequestedRange: z.boolean(),
        warningCode: z.literal("SURVIVORSHIP_COVERAGE_PARTIAL").nullable(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

const legManifestSchema = z
  .object({
    strategyCode: z.string().min(1),
    strategyVersion: z.string().min(1),
  })
  .passthrough();

type ArtifactKind = BacktestArtifact["kind"];

function artifactByKind(
  artifacts: BacktestArtifact[],
  kind: ArtifactKind,
  required = true,
): BacktestArtifact | undefined {
  const found = artifacts.filter((artifact) => artifact.kind === kind);
  if (found.length > 1) throw new Error(`Duplicate ${kind} artifact in one scope.`);
  if (required && found.length === 0) throw new Error(`Missing ${kind} artifact.`);
  return found[0];
}

function parsePayload<T>(schema: z.ZodType<T>, payload: unknown, label: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error(`Invalid ${label} artifact payload.`);
  return parsed.data;
}

function validateScopes(run: BacktestRun) {
  const legIds = new Set(run.legs.map((leg) => leg.id));
  const keys = new Set<string>();
  for (const artifact of run.artifacts) {
    if (artifact.scopeKey === "aggregate") {
      if (artifact.quantRunLegId !== null) throw new Error("Invalid aggregate artifact scope.");
    } else {
      const legId = artifact.quantRunLegId;
      if (!legId || artifact.scopeKey !== `leg:${legId}` || !legIds.has(legId)) {
        throw new Error("Invalid per-leg artifact scope.");
      }
    }
    const key = `${artifact.scopeKey}:${artifact.kind}`;
    if (keys.has(key)) throw new Error("Duplicate artifact scope and kind.");
    keys.add(key);
  }
}

export type ContributionPoint = z.infer<typeof contributionPointSchema>;
export type CashFlowPoint = z.infer<typeof cashFlowPointSchema>;
export type RebalancePoint = z.infer<typeof rebalancePointSchema>;
export type RobustnessDiagnostics = z.infer<typeof robustnessSchema>;

export type BacktestResultModel = {
  aggregate: {
    label: string;
    metrics: Record<string, unknown>;
    equity: Extract<BacktestArtifact, { kind: "equity" }>["payload"];
    drawdown: Extract<BacktestArtifact, { kind: "drawdown" }>["payload"];
    contribution: ContributionPoint[];
    cashFlow: CashFlowPoint[];
    rebalance: RebalancePoint[];
    assumptions: z.infer<typeof displayedAssumptionsSchema>;
    analytics: Record<string, unknown> | null;
    reportHtml: string | null;
    robustness: RobustnessDiagnostics | null;
    historicalCoverage: {
      firstObservedAt: string | null;
      completeForRequestedRange: boolean;
      warningCode: "SURVIVORSHIP_COVERAGE_PARTIAL" | null;
    } | null;
  };
  legs: Array<{
    id: string;
    symbol: string;
    label: string;
    allocationBps: number;
    initialNotional: number;
    strategyCode: string;
    strategyVersion: string;
    strategyParameters: Record<string, unknown>;
    datasetVersionId: string;
    metrics: Record<string, unknown>;
    equity: Extract<BacktestArtifact, { kind: "equity" }>["payload"];
    drawdown: Extract<BacktestArtifact, { kind: "drawdown" }>["payload"];
    trades: Extract<BacktestArtifact, { kind: "trades" }>["payload"];
  }>;
};

export function buildBacktestResultModel(run: BacktestRun): BacktestResultModel {
  if (run.status !== "succeeded") throw new Error("Backtest results require a succeeded run.");
  validateScopes(run);
  const aggregateArtifacts = run.artifacts.filter((artifact) => artifact.scopeKey === "aggregate");
  const equityArtifact = artifactByKind(aggregateArtifacts, "equity");
  const drawdownArtifact = artifactByKind(aggregateArtifacts, "drawdown");
  const contributionArtifact = artifactByKind(aggregateArtifacts, "contribution");
  const cashFlowArtifact = artifactByKind(aggregateArtifacts, "cash_flow");
  const rebalanceArtifact = artifactByKind(aggregateArtifacts, "rebalance");
  const manifestArtifact = artifactByKind(aggregateArtifacts, "manifest");
  const analyticsArtifact = artifactByKind(aggregateArtifacts, "analytics", false);
  const reportArtifact = artifactByKind(aggregateArtifacts, "report_html", false);
  const robustnessArtifact = artifactByKind(aggregateArtifacts, "robustness", false);
  if (
    equityArtifact?.kind !== "equity" ||
    drawdownArtifact?.kind !== "drawdown" ||
    contributionArtifact?.kind !== "contribution" ||
    cashFlowArtifact?.kind !== "cash_flow" ||
    rebalanceArtifact?.kind !== "rebalance" ||
    manifestArtifact?.kind !== "manifest"
  ) {
    throw new Error("Invalid aggregate artifact set.");
  }
  const aggregateManifest = parsePayload(
    aggregateManifestSchema,
    manifestArtifact.payload,
    "manifest",
  );

  const legs = [...run.legs]
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
    .map((leg) => {
      const artifacts = run.artifacts.filter((artifact) => artifact.scopeKey === `leg:${leg.id}`);
      const legEquity = artifactByKind(artifacts, "equity");
      const legDrawdown = artifactByKind(artifacts, "drawdown", false);
      const legTrades = artifactByKind(artifacts, "trades");
      const legManifest = artifactByKind(artifacts, "manifest");
      if (
        legEquity?.kind !== "equity" ||
        legTrades?.kind !== "trades" ||
        legManifest?.kind !== "manifest" ||
        (legDrawdown !== undefined && legDrawdown.kind !== "drawdown")
      ) {
        throw new Error(`Invalid artifact set for ${leg.symbol}.`);
      }
      const manifest = parsePayload(legManifestSchema, legManifest.payload, "leg manifest");
      if (
        manifest.strategyCode !== leg.strategyCode ||
        manifest.strategyVersion !== leg.strategyVersion
      ) {
        throw new Error(`Strategy manifest mismatch for ${leg.symbol}.`);
      }
      if (legTrades.payload.some((trade) => trade.asset !== leg.symbol)) {
        throw new Error(`Invalid trade asset for ${leg.symbol}.`);
      }
      return {
        id: leg.id,
        symbol: leg.symbol,
        label: `${leg.symbol} · ${leg.strategyName}`,
        allocationBps: leg.allocationBps,
        initialNotional: leg.initialNotional,
        strategyCode: leg.strategyCode,
        strategyVersion: leg.strategyVersion,
        strategyParameters: leg.strategyParameters,
        datasetVersionId: leg.datasetVersionId,
        metrics: leg.metrics ?? {},
        equity: legEquity.payload,
        drawdown: legDrawdown?.kind === "drawdown" ? legDrawdown.payload : [],
        trades: legTrades.payload,
      };
    });

  return {
    aggregate: {
      label: "Normalized portfolio simulation",
      metrics: run.metrics ?? {},
      equity: equityArtifact.payload,
      drawdown: drawdownArtifact.payload,
      contribution: parsePayload(
        z.array(contributionPointSchema),
        contributionArtifact.payload,
        "contribution",
      ),
      cashFlow: parsePayload(z.array(cashFlowPointSchema), cashFlowArtifact.payload, "cash-flow"),
      rebalance: parsePayload(
        z.array(rebalancePointSchema),
        rebalanceArtifact.payload,
        "rebalance",
      ),
      assumptions: aggregateManifest.assumptions,
      analytics:
        analyticsArtifact?.kind === "analytics"
          ? parsePayload(z.record(z.string(), z.unknown()), analyticsArtifact.payload, "analytics")
          : null,
      reportHtml: reportArtifact?.kind === "report_html" ? reportArtifact.payload : null,
      robustness:
        robustnessArtifact?.kind === "robustness"
          ? parsePayload(robustnessSchema, robustnessArtifact.payload, "robustness")
          : null,
      historicalCoverage: aggregateManifest.historicalCoverage ?? null,
    },
    legs,
  };
}
