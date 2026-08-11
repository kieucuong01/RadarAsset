import type { OptimizerProposal } from "./optimizer-client";

export const OPTIMIZER_CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--primary)",
  "var(--bull)",
  "var(--bear)",
  "var(--accent-foreground)",
  "var(--muted-foreground)",
];

export type OptimizerAllocationSlice = {
  symbol: string;
  weightPct: number;
  color: string;
  datasetVersionId: string;
};

export type OptimizerRiskReturnPoint = {
  symbol: string;
  expectedReturnPct: number;
  volatilityPct: number;
  weightPct: number;
  datasetVersionId: string;
};

export type OptimizerCorrelationRow = {
  symbol: string;
  values: Array<{ symbol: string; value: number }>;
};

function pctFromBps(value: number) {
  return Number((value / 100).toFixed(2));
}

function allocationOrder(proposal: OptimizerProposal) {
  return Object.entries(proposal.weightsBps)
    .map(([symbol, weightBps]) => ({ symbol, weightBps }))
    .sort(
      (left, right) => right.weightBps - left.weightBps || left.symbol.localeCompare(right.symbol),
    )
    .map((item) => item.symbol);
}

export function buildOptimizerDashboardModel(proposal: OptimizerProposal) {
  const symbols = allocationOrder(proposal);
  const metricBySymbol = new Map(proposal.assetMetrics.map((metric) => [metric.symbol, metric]));
  const correlationBySymbol = new Map(
    proposal.correlationMatrix.map((row) => [row.symbol, row.correlations]),
  );

  const allocationSlices: OptimizerAllocationSlice[] = symbols.map((symbol, index) => ({
    symbol,
    weightPct: pctFromBps(proposal.weightsBps[symbol] ?? 0),
    color: OPTIMIZER_CHART_COLORS[index % OPTIMIZER_CHART_COLORS.length],
    datasetVersionId: proposal.datasetVersionIds[symbol] ?? "",
  }));

  const riskReturnPoints: OptimizerRiskReturnPoint[] = symbols.map((symbol) => {
    const metric = metricBySymbol.get(symbol);
    return {
      symbol,
      expectedReturnPct: metric?.expectedReturnPct ?? 0,
      volatilityPct: metric?.volatilityPct ?? 0,
      weightPct: pctFromBps(proposal.weightsBps[symbol] ?? 0),
      datasetVersionId: proposal.datasetVersionIds[symbol] ?? "",
    };
  });

  const correlationRows: OptimizerCorrelationRow[] = symbols.map((symbol) => {
    const correlations = correlationBySymbol.get(symbol) ?? {};
    return {
      symbol,
      values: symbols.map((rightSymbol) => ({
        symbol: rightSymbol,
        value: correlations[rightSymbol] ?? 0,
      })),
    };
  });

  return { symbols, allocationSlices, riskReturnPoints, correlationRows };
}
