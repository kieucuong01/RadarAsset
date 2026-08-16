import type { Prisma } from "@prisma/client";
import type { TenantContext } from "@/lib/auth/tenant-context";
import { normalizeStrategyAssignment } from "@/lib/backtest/assignment-contracts";
import { getPrisma } from "@/lib/db/prisma";

import { numberFromDecimal, objectJson } from "./db-mappers";
import { PortfolioInputError } from "./portfolio";
import type {
  StrategyAssignmentCreateInput,
  StrategyAssignmentResponse,
  StrategySignalResponse,
} from "./types";

function assertStrategySignalType(value: string): "buy" | "sell" {
  if (value === "buy" || value === "sell") return value;
  throw new Error(`Unsupported strategy signal type: ${value}.`);
}

function assertStrategySignalStatus(value: string): StrategySignalResponse["status"] {
  if (
    value === "suggested" ||
    value === "reviewed" ||
    value === "executed" ||
    value === "dismissed"
  ) {
    return value;
  }
  throw new Error(`Unsupported strategy signal status: ${value}.`);
}

function strategySignalToResponse(signal: {
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
}): StrategySignalResponse {
  return {
    id: signal.id,
    symbol: signal.asset.symbol,
    strategyCode: signal.strategyVersion.code,
    strategyVersion: signal.strategyVersion.version,
    signalType: assertStrategySignalType(signal.signalType),
    status: assertStrategySignalStatus(signal.status),
    signalAt: signal.signalAt.toISOString(),
    executionAt: signal.executionAt?.toISOString() ?? null,
    signalPrice: signal.signalPrice === null ? null : numberFromDecimal(signal.signalPrice),
    reason: signal.reason,
    metadata: objectJson(signal.metadata),
  };
}

function strategyAssignmentToResponse(assignment: {
  id: string;
  portfolioId: string;
  parameters: unknown;
  status: string;
  asset: { symbol: string; currency?: string };
  strategyVersion: { code: string; version: string; name: string };
  signals: Array<Parameters<typeof strategySignalToResponse>[0]>;
}): StrategyAssignmentResponse {
  return {
    id: assignment.id,
    portfolioId: assignment.portfolioId,
    symbol: assignment.asset.symbol,
    ...(assignment.asset.currency ? { currency: assignment.asset.currency } : {}),
    strategyCode: assignment.strategyVersion.code,
    strategyVersion: assignment.strategyVersion.version,
    strategyName: assignment.strategyVersion.name,
    parameters: objectJson(assignment.parameters),
    status: assignment.status === "paused" ? "paused" : "active",
    signals: assignment.signals.map(strategySignalToResponse),
  };
}

function isoDate(value: unknown, field: string): Date {
  if (typeof value !== "string") throw new Error(`Backtest artifact ${field} is invalid.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Backtest artifact ${field} is invalid.`);
  return date;
}

function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Backtest artifact ${field} is invalid.`);
  }
  return value;
}

function signalsFromBacktestArtifact(
  symbol: string,
  runId: string,
  runLegId: string,
  payload: unknown,
  assetId: string,
  strategyVersionId: string,
) {
  if (!Array.isArray(payload)) throw new Error("Backtest trades artifact is invalid.");
  return payload.flatMap((trade) => {
    if (!trade || typeof trade !== "object" || Array.isArray(trade)) {
      throw new Error("Backtest trades artifact is invalid.");
    }
    const row = trade as Record<string, unknown>;
    if (row.asset !== symbol) return [];
    const entrySignalAt = isoDate(row.entrySignalAt, "entrySignalAt");
    const entryPrice = positiveNumber(row.entryPrice, "entryPrice");
    const exitSignalAt = isoDate(row.exitSignalAt, "exitSignalAt");
    const exitPrice = positiveNumber(row.exitPrice, "exitPrice");
    const metadata = { source: "backtest", runId, runLegId };
    return [
      {
        assetId,
        strategyVersionId,
        signalType: "buy",
        status: "suggested",
        signalAt: entrySignalAt,
        signalPrice: entryPrice,
        reason: "Backtest entry signal",
        metadata,
      },
      {
        assetId,
        strategyVersionId,
        signalType: "sell",
        status: "suggested",
        signalAt: exitSignalAt,
        signalPrice: exitPrice,
        reason: "Backtest exit signal",
        metadata,
      },
    ];
  });
}

export async function upsertStrategyAssignment(
  context: TenantContext,
  input: StrategyAssignmentCreateInput,
): Promise<StrategyAssignmentResponse> {
  const prisma = getPrisma();
  const normalized = normalizeStrategyAssignment(input);
  const portfolio = await prisma.portfolio.findFirst({
    where: { organizationId: context.organizationId },
    select: { id: true },
  });
  if (!portfolio) throw new Error("Portfolio not found.");
  const asset = await prisma.asset.findUnique({
    where: { symbol: normalized.symbol },
    select: { id: true, symbol: true },
  });
  if (!asset)
    throw new PortfolioInputError(`Asset ${normalized.symbol} not found.`, "ASSET_NOT_FOUND");
  const strategyVersion = await prisma.strategyVersion.findUnique({
    where: { code_version: { code: normalized.strategyCode, version: normalized.strategyVersion } },
    select: { id: true, code: true, version: true, name: true },
  });
  if (!strategyVersion) {
    throw new Error(
      `Strategy ${normalized.strategyCode}@${normalized.strategyVersion} is not synchronized in the catalog.`,
    );
  }

  let signalRows: Array<Record<string, unknown>> = [];
  if (normalized.backtestRunId && normalized.backtestRunLegId) {
    const run = await prisma.quantRun.findFirst({
      where: {
        id: normalized.backtestRunId,
        organizationId: context.organizationId,
        status: "succeeded",
        legs: {
          some: {
            id: normalized.backtestRunLegId,
            assetId: asset.id,
            strategyVersionId: strategyVersion.id,
          },
        },
      },
      select: {
        legs: {
          where: { id: normalized.backtestRunLegId },
          select: {
            id: true,
            symbolSnapshot: true,
            parameters: true,
            strategyVersion: { select: { code: true, version: true } },
            artifacts: {
              where: {
                organizationId: context.organizationId,
                kind: "trades",
                scopeKey: `leg:${normalized.backtestRunLegId}`,
              },
              select: { payload: true },
            },
          },
        },
      },
    });
    if (!run) throw new Error("Backtest run not found or not succeeded.");
    const leg = run.legs[0];
    if (
      !leg ||
      leg.symbolSnapshot !== normalized.symbol ||
      leg.strategyVersion.code !== normalized.strategyCode ||
      leg.strategyVersion.version !== normalized.strategyVersion ||
      JSON.stringify(objectJson(leg.parameters)) !== JSON.stringify(normalized.strategyParameters)
    ) {
      throw new Error("Backtest leg does not match the requested strategy assignment.");
    }
    const tradesArtifact = leg.artifacts[0];
    if (!tradesArtifact) throw new Error("Backtest leg has no trades artifact.");
    signalRows = signalsFromBacktestArtifact(
      normalized.symbol,
      normalized.backtestRunId,
      normalized.backtestRunLegId,
      tradesArtifact.payload,
      asset.id,
      strategyVersion.id,
    );
  }

  const existingAssignment = await prisma.strategyAssignment.findFirst({
    where: { portfolioId: portfolio.id, assetId: asset.id, status: "active" },
    select: { id: true },
  });
  const assignment = existingAssignment
    ? await prisma.strategyAssignment.update({
        where: { id: existingAssignment.id },
        data: {
          strategyVersionId: strategyVersion.id,
          parameters: normalized.strategyParameters as Prisma.InputJsonValue,
          status: "active",
        },
        include: {
          asset: true,
          strategyVersion: { select: { code: true, version: true, name: true } },
          signals: {
            orderBy: { signalAt: "desc" },
            include: { asset: true, strategyVersion: { select: { code: true, version: true } } },
          },
        },
      })
    : await prisma.strategyAssignment.create({
        data: {
          organizationId: context.organizationId,
          portfolioId: portfolio.id,
          assetId: asset.id,
          strategyVersionId: strategyVersion.id,
          parameters: normalized.strategyParameters as Prisma.InputJsonValue,
          status: "active",
        },
        include: {
          asset: true,
          strategyVersion: { select: { code: true, version: true, name: true } },
          signals: {
            orderBy: { signalAt: "desc" },
            include: { asset: true, strategyVersion: { select: { code: true, version: true } } },
          },
        },
      });
  if (signalRows.length) {
    await prisma.strategySignal.createMany({
      data: signalRows.map((row) => ({
        ...row,
        organizationId: context.organizationId,
        assignmentId: assignment.id,
      })) as Prisma.StrategySignalCreateManyInput[],
      skipDuplicates: true,
    });
  }
  const refreshed = await prisma.strategyAssignment.findUnique({
    where: { id: assignment.id },
    include: {
      asset: true,
      strategyVersion: { select: { code: true, version: true, name: true } },
      signals: {
        orderBy: { signalAt: "desc" },
        include: { asset: true, strategyVersion: { select: { code: true, version: true } } },
      },
    },
  });
  if (!refreshed) throw new Error("Strategy assignment could not be loaded.");
  return strategyAssignmentToResponse(refreshed);
}

export async function listStrategyAssignments(
  context: TenantContext,
): Promise<StrategyAssignmentResponse[]> {
  const prisma = getPrisma();
  const portfolio = await prisma.portfolio.findFirst({
    where: { organizationId: context.organizationId },
    select: { id: true },
  });
  if (!portfolio) return [];
  const assignments = await prisma.strategyAssignment.findMany({
    where: { organizationId: context.organizationId, portfolioId: portfolio.id },
    orderBy: { createdAt: "desc" },
    include: {
      asset: true,
      strategyVersion: { select: { code: true, version: true, name: true } },
      signals: {
        orderBy: { signalAt: "desc" },
        include: { asset: true, strategyVersion: { select: { code: true, version: true } } },
      },
    },
  });
  return assignments.map(strategyAssignmentToResponse);
}

export async function updateStrategySignalStatus(
  context: TenantContext,
  signalId: string,
  status: StrategySignalResponse["status"],
): Promise<StrategySignalResponse> {
  const prisma = getPrisma();
  assertStrategySignalStatus(status);
  const existing = await prisma.strategySignal.findFirst({
    where: { id: signalId, organizationId: context.organizationId },
  });
  if (!existing) throw new Error("Strategy signal not found.");
  const signal = await prisma.strategySignal.update({
    where: { id: signalId },
    data: { status, executionAt: status === "executed" ? new Date() : null },
    include: { asset: true, strategyVersion: { select: { code: true, version: true } } },
  });
  return strategySignalToResponse(signal);
}
