import { createHash } from "node:crypto";

import { normalizeBacktestSubmission, type PortfolioBacktestSubmission } from "./contracts";

export type ResolvedPortfolioHashLeg = {
  symbol: string;
  assetId: string;
  datasetVersionId: string;
  datasetChecksum: string;
  strategyVersionId: string;
  implementationHash: string;
  allocationBps: number;
  leverage: number;
  strategyParameters: Record<string, unknown>;
};

export function hashBacktestSubmission(input: unknown) {
  const normalized = normalizeBacktestSubmission(input);
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

export function hashResolvedPortfolioRun(
  input: PortfolioBacktestSubmission,
  legs: ResolvedPortfolioHashLeg[],
) {
  const normalized = normalizeBacktestSubmission(input);
  const resolvedLegs = [...legs]
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
    .map((leg) => ({
      symbol: leg.symbol,
      assetId: leg.assetId,
      datasetVersionId: leg.datasetVersionId,
      datasetChecksum: leg.datasetChecksum,
      strategyVersionId: leg.strategyVersionId,
      implementationHash: leg.implementationHash,
      allocationBps: leg.allocationBps,
      leverage: leg.leverage,
      strategyParameters: Object.fromEntries(
        Object.entries(leg.strategyParameters).sort(([left], [right]) => left.localeCompare(right)),
      ),
    }));
  return createHash("sha256")
    .update(JSON.stringify({ submission: normalized, resolvedLegs }), "utf8")
    .digest("hex");
}
