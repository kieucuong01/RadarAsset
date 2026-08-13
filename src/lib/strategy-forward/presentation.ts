import type { ForwardTest } from "./client";

export function buildForwardChart(snapshots: ForwardTest["snapshots"]) {
  if (!snapshots.length || snapshots[0].equity === 0 || snapshots[0].benchmarkEquity === 0)
    return [];
  const strategyBase = snapshots[0].equity;
  const benchmarkBase = snapshots[0].benchmarkEquity;
  return snapshots.map((row) => ({
    timestamp: row.timestamp,
    strategy: (row.equity / strategyBase) * 100,
    buyHold: (row.benchmarkEquity / benchmarkBase) * 100,
  }));
}

export function buildForwardComparison(
  snapshots: ForwardTest["snapshots"],
  baseline: { totalReturnPct: number } | null,
) {
  const chart = buildForwardChart(snapshots);
  const latest = chart.at(-1);
  if (!latest || !baseline) return null;
  const forwardReturnPct = latest.strategy - 100;
  const buyHoldReturnPct = latest.buyHold - 100;
  return {
    forwardReturnPct,
    buyHoldReturnPct,
    backtestReturnPct: baseline.totalReturnPct,
    backtestGapPctPoints: forwardReturnPct - baseline.totalReturnPct,
  };
}
