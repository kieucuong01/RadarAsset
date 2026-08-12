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
