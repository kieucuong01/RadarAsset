import type { Prisma } from "@prisma/client";

import type { TenantContext } from "@/lib/auth/tenant-context";
import {
  normalizeStrategyAssignment,
  type StrategyAssignmentInput,
} from "@/lib/backtest/assignment-contracts";
import { getPrisma } from "@/lib/db/prisma";

import type { StrategyAssignmentResponse, StrategySignalResponse } from "./types";

const ELIGIBLE_DATASET_QUALITY = ["passed", "warning"];

function numberFromDecimal(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object" && "toString" in value) return Number(value.toString());
  return 0;
}

function objectJson(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assignmentResponse(assignment: {
  id: string;
  portfolioId: string;
  parameters: unknown;
  status: string;
  asset: { symbol: string };
  strategyVersion: { code: string; version: string; name: string };
  signals: Array<{
    id: string;
    signalType: string;
    status: string;
    signalAt: Date;
    executionAt: Date | null;
    signalPrice: unknown | null;
    reason: string | null;
    metadata: unknown;
    asset: { symbol: string };
    strategyVersion: { code: string; version: string };
  }>;
}): StrategyAssignmentResponse {
  return {
    id: assignment.id,
    portfolioId: assignment.portfolioId,
    symbol: assignment.asset.symbol,
    strategyCode: assignment.strategyVersion.code,
    strategyVersion: assignment.strategyVersion.version,
    strategyName: assignment.strategyVersion.name,
    parameters: objectJson(assignment.parameters),
    status: assignment.status === "paused" ? "paused" : "active",
    signals: assignment.signals
      .filter((signal) => signal.signalType === "buy" || signal.signalType === "sell")
      .map(
        (signal): StrategySignalResponse => ({
          id: signal.id,
          symbol: signal.asset.symbol,
          strategyCode: signal.strategyVersion.code,
          strategyVersion: signal.strategyVersion.version,
          signalType: signal.signalType as "buy" | "sell",
          status: ["suggested", "reviewed", "executed", "dismissed"].includes(signal.status)
            ? (signal.status as StrategySignalResponse["status"])
            : "reviewed",
          signalAt: signal.signalAt.toISOString(),
          executionAt: signal.executionAt?.toISOString() ?? null,
          signalPrice: signal.signalPrice === null ? null : numberFromDecimal(signal.signalPrice),
          reason: signal.reason,
          metadata: objectJson(signal.metadata),
        }),
      ),
  };
}

export async function applyStrategyAssignment(
  context: TenantContext,
  rawInput: StrategyAssignmentInput,
): Promise<StrategyAssignmentResponse> {
  const input = normalizeStrategyAssignment(rawInput);
  if (!input.backtestRunId || !input.backtestRunLegId) {
    throw new Error("SOURCE_RUN_MISMATCH: A succeeded source run and leg are required.");
  }

  return getPrisma().$transaction(async (tx) => {
    const portfolio = await tx.portfolio.findFirst({
      where: { organizationId: context.organizationId },
      select: { id: true, userId: true },
    });
    if (!portfolio) throw new Error("Portfolio not found.");

    const run = await tx.quantRun.findFirst({
      where: {
        id: input.backtestRunId,
        organizationId: context.organizationId,
        status: "succeeded",
      },
      select: {
        id: true,
        status: true,
        timeframe: true,
        legs: {
          where: { id: input.backtestRunLegId },
          select: {
            id: true,
            assetId: true,
            symbolSnapshot: true,
            currencySnapshot: true,
            parameters: true,
            implementationHash: true,
            initialNotional: true,
            datasetVersionId: true,
            datasetVersion: {
              select: {
                isActive: true,
                qualityStatus: true,
                bars: { orderBy: { ts: "desc" }, take: 1, select: { ts: true, close: true } },
              },
            },
            strategyVersion: {
              select: {
                id: true,
                code: true,
                version: true,
                implementationHash: true,
                status: true,
                customStrategyVersion: {
                  select: { status: true, customStrategy: { select: { status: true } } },
                },
              },
            },
          },
        },
      },
    });
    const leg = run?.legs[0];
    if (
      !leg ||
      leg.symbolSnapshot !== input.symbol ||
      leg.strategyVersion.code !== input.strategyCode ||
      leg.strategyVersion.version !== input.strategyVersion ||
      leg.implementationHash !== leg.strategyVersion.implementationHash ||
      JSON.stringify(objectJson(leg.parameters)) !== JSON.stringify(input.strategyParameters)
    ) {
      throw new Error("SOURCE_RUN_MISMATCH: Backtest run or leg does not match the assignment.");
    }
    if (
      leg.strategyVersion.status !== "active" ||
      leg.strategyVersion.customStrategyVersion?.status === "retired" ||
      leg.strategyVersion.customStrategyVersion?.customStrategy.status === "archived"
    ) {
      throw new Error("STRATEGY_UNAVAILABLE: Strategy version is not active.");
    }
    const latestBar = leg.datasetVersion.bars[0];
    if (
      !leg.datasetVersion.isActive ||
      !ELIGIBLE_DATASET_QUALITY.includes(leg.datasetVersion.qualityStatus) ||
      !latestBar
    ) {
      throw new Error("DATASET_UNAVAILABLE: Active dataset has no eligible as-of bar.");
    }

    const position = await tx.portfolioPosition.findUnique({
      where: { portfolioId_assetId: { portfolioId: portfolio.id, assetId: leg.assetId } },
      select: { quantity: true, averageCost: true },
    });
    const quantity = numberFromDecimal(position?.quantity ?? 0);
    const price = numberFromDecimal(latestBar.close);
    const initialNotional = numberFromDecimal(leg.initialNotional);
    const marketValue = quantity * price;
    const simulatedCash = Math.max(0, initialNotional - marketValue);

    await tx.strategyAssignment.updateMany({
      where: {
        organizationId: context.organizationId,
        portfolioId: portfolio.id,
        assetId: leg.assetId,
        status: "active",
      },
      data: { status: "archived" },
    });
    const assignment = await tx.strategyAssignment.create({
      data: {
        organizationId: context.organizationId,
        portfolioId: portfolio.id,
        assetId: leg.assetId,
        strategyVersionId: leg.strategyVersion.id,
        parameters: input.strategyParameters as Prisma.InputJsonValue,
        status: "active",
        activatedAt: new Date(),
        lastEvaluatedAt: new Date(),
        lastEvaluatedDatasetVersionId: leg.datasetVersionId,
        lastEvaluatedBarAt: latestBar.ts,
        sourceQuantRunId: run.id,
        sourceQuantRunLegId: leg.id,
        state: {
          simulatedCash,
          simulatedQuantity: quantity,
          cumulativeContributions: 0,
          cumulativeFees: 0,
          startingEquity: initialNotional,
          benchmarkQuantity: price > 0 ? initialNotional / price : 0,
        },
      },
      select: { id: true },
    });
    await tx.strategySignal.create({
      data: {
        organizationId: context.organizationId,
        assignmentId: assignment.id,
        assetId: leg.assetId,
        strategyVersionId: leg.strategyVersion.id,
        datasetVersionId: leg.datasetVersionId,
        signalType: "buy",
        eventType: "INITIAL_SNAPSHOT",
        status: "reviewed",
        signalAt: latestBar.ts,
        signalPrice: price,
        reason: "Forward test activated",
        metadata: { source: "activation", actionable: false },
      },
    });
    await tx.strategyForwardSnapshot.create({
      data: {
        organizationId: context.organizationId,
        assignmentId: assignment.id,
        datasetVersionId: leg.datasetVersionId,
        barAt: latestBar.ts,
        simulatedCash,
        simulatedQuantity: quantity,
        marketValue,
        equity: simulatedCash + marketValue,
        cumulativeContributions: 0,
        cumulativeFees: 0,
        pnlExcludingContributions: simulatedCash + marketValue - initialNotional,
        benchmarkEquity: initialNotional,
      },
    });

    const refreshed = await tx.strategyAssignment.findUnique({
      where: { id: assignment.id },
      include: {
        asset: true,
        strategyVersion: { select: { code: true, version: true, name: true } },
        signals: {
          where: { eventType: { not: "INITIAL_SNAPSHOT" } },
          orderBy: { signalAt: "desc" },
          include: { asset: true, strategyVersion: { select: { code: true, version: true } } },
        },
      },
    });
    if (!refreshed) throw new Error("Strategy assignment could not be loaded.");
    return assignmentResponse(refreshed);
  });
}
