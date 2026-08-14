import type { Prisma } from "@prisma/client";

import type { TenantContext } from "@/lib/auth/tenant-context";
import { notionalFromBps } from "@/lib/backtest/allocation";
import {
  normalizeBacktestSubmission,
  type PortfolioBacktestSubmission,
} from "@/lib/backtest/contracts";
import { normalizeExecutableRule } from "@/lib/custom-strategies/contracts";
import { hashResolvedPortfolioRun, type ResolvedPortfolioHashLeg } from "@/lib/backtest/hash";
import { getPrisma } from "@/lib/db/prisma";

import type { QuantRunResponse, QuantRunStatus } from "./types";

const MARKET_LEVERAGE_CAP = {
  vn_equity: 2,
  crypto_spot: 1,
  metal_spot: 1,
} as const;
const ELIGIBLE_DATASET_QUALITY = ["passed", "warning"] as const;
const PORTFOLIO_ENGINE_VERSION = "portfolio-v1";
const RUN_TIMEOUT_MS = 15 * 60 * 1_000;

type SupportedMarket = keyof typeof MARKET_LEVERAGE_CAP;
type ArtifactKind = QuantRunResponse["artifacts"][number]["kind"];
type EligibilityCode =
  | "ASSET_UNAVAILABLE"
  | "DATASET_UNAVAILABLE"
  | "DATASET_RANGE_INSUFFICIENT"
  | "DATASET_PROVIDER_GAP"
  | "DATASET_CALENDAR_UNVERIFIED"
  | "LEVERAGE_LIMIT_EXCEEDED"
  | "STRATEGY_UNAVAILABLE"
  | "STRATEGY_UNSUPPORTED";

export class PortfolioRunEligibilityError extends Error {
  constructor(
    readonly code: EligibilityCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "PortfolioRunEligibilityError";
  }
}

type ResolvedLeg = ResolvedPortfolioHashLeg & {
  market: SupportedMarket;
  currency: string;
  initialNotional: number;
  strategyCode: string;
  strategyVersion: string;
  listingFirstObservedAt: string | null;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function supportedMarket(value: string): SupportedMarket | null {
  return Object.hasOwn(MARKET_LEVERAGE_CAP, value) ? (value as SupportedMarket) : null;
}

function storedMarket(value: string): SupportedMarket {
  const market = supportedMarket(value);
  if (!market) throw new Error("Unsupported Quant market returned from storage.");
  return market;
}

function currencyMatchesRule(assetCurrency: string, ruleCurrency: string) {
  return assetCurrency === ruleCurrency || (ruleCurrency === "USD" && assetCurrency === "USDT");
}

function artifactKind(value: string): ArtifactKind {
  const kinds: ArtifactKind[] = [
    "equity",
    "drawdown",
    "trades",
    "manifest",
    "analytics",
    "report_html",
    "benchmark",
    "contribution",
    "cash_flow",
    "rebalance",
    "robustness",
  ];
  if (kinds.includes(value as ArtifactKind)) return value as ArtifactKind;
  throw new Error("Unsupported Quant artifact kind returned from storage.");
}

function dateBoundary(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

async function resolvePortfolioLegs(
  context: TenantContext,
  input: PortfolioBacktestSubmission,
): Promise<ResolvedLeg[]> {
  const prisma = getPrisma();
  const strategyKeys = input.legs.map((leg) => ({
    code: leg.strategyCode,
    version: leg.strategyVersion,
  }));
  const strategies = await prisma.strategyVersion.findMany({
    where: {
      OR: strategyKeys,
      AND: [{ OR: [{ organizationId: null }, { organizationId: context.organizationId }] }],
    },
    select: {
      id: true,
      code: true,
      version: true,
      name: true,
      status: true,
      organizationId: true,
      implementationHash: true,
      supportedMarkets: true,
      supportedTimeframes: true,
      customStrategyVersion: {
        select: {
          status: true,
          ruleDefinition: true,
          customStrategy: { select: { status: true } },
        },
      },
    },
  });
  const strategyByKey = new Map(
    strategies.map((strategy) => [`${strategy.code}@${strategy.version}`, strategy]),
  );
  for (const leg of input.legs) {
    if (!strategyByKey.has(`${leg.strategyCode}@${leg.strategyVersion}`)) {
      throw new PortfolioRunEligibilityError(
        "STRATEGY_UNAVAILABLE",
        `${leg.strategyCode}@${leg.strategyVersion} is not synchronized.`,
      );
    }
  }

  const adjustmentPolicy =
    input.assumptions.dividendMode === "adjusted_prices" ? "total_return" : "raw";
  const assets = await prisma.asset.findMany({
    where: { symbol: { in: input.legs.map((leg) => leg.symbol) } },
    select: {
      id: true,
      symbol: true,
      market: true,
      currency: true,
      maxLeverage: true,
      listingPeriods: {
        orderBy: { validFrom: "asc" },
        take: 1,
        select: { validFrom: true },
      },
      datasets: {
        where: { timeframe: input.timeframe, adjustmentPolicy },
        take: 1,
        select: {
          versions: {
            where: { isActive: true, qualityStatus: { in: [...ELIGIBLE_DATASET_QUALITY] } },
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              checksum: true,
              coverageStart: true,
              coverageEnd: true,
              rowCount: true,
              issues: {
                where: {
                  rangeStart: { lte: dateBoundary(input.to) },
                  rangeEnd: { gte: dateBoundary(input.from) },
                  classification: { in: ["PROVIDER_GAP", "CALENDAR_RANGE_UNVERIFIED"] },
                },
                select: { classification: true },
              },
            },
          },
        },
      },
    },
  });
  const assetBySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));
  const requestedStart = dateBoundary(input.from);
  const requestedEnd = dateBoundary(input.to);

  return input.legs.map((leg) => {
    const asset = assetBySymbol.get(leg.symbol);
    if (!asset) {
      throw new PortfolioRunEligibilityError("ASSET_UNAVAILABLE", `${leg.symbol} is unavailable.`);
    }
    const market = supportedMarket(asset.market);
    if (!market) {
      throw new PortfolioRunEligibilityError(
        "ASSET_UNAVAILABLE",
        `${leg.symbol} is not supported by Quant Lab.`,
      );
    }
    const dataset = asset.datasets[0]?.versions[0];
    if (!dataset) {
      throw new PortfolioRunEligibilityError(
        "DATASET_UNAVAILABLE",
        `No active ${adjustmentPolicy} ${input.timeframe} dataset is available for ${leg.symbol}.`,
      );
    }
    if (dataset.coverageStart > requestedStart || dataset.coverageEnd < requestedEnd) {
      throw new PortfolioRunEligibilityError(
        "DATASET_RANGE_INSUFFICIENT",
        `${leg.symbol} does not cover the requested range.`,
      );
    }
    if (dataset.issues.some((issue) => issue.classification === "CALENDAR_RANGE_UNVERIFIED")) {
      throw new PortfolioRunEligibilityError(
        "DATASET_CALENDAR_UNVERIFIED",
        `${leg.symbol} intersects an uncertified calendar range.`,
      );
    }
    if (dataset.issues.some((issue) => issue.classification === "PROVIDER_GAP")) {
      throw new PortfolioRunEligibilityError(
        "DATASET_PROVIDER_GAP",
        `${leg.symbol} intersects a provider data gap.`,
      );
    }
    const strategy = strategyByKey.get(`${leg.strategyCode}@${leg.strategyVersion}`);
    if (!strategy || strategy.status !== "active") {
      throw new PortfolioRunEligibilityError(
        "STRATEGY_UNAVAILABLE",
        `${leg.strategyCode}@${leg.strategyVersion} is not active.`,
      );
    }
    const customRule = strategy.customStrategyVersion
      ? normalizeExecutableRule(strategy.customStrategyVersion.ruleDefinition)
      : null;
    if (
      strategy.customStrategyVersion &&
      (strategy.customStrategyVersion.status !== "active" ||
        strategy.customStrategyVersion.customStrategy.status !== "active")
    ) {
      throw new PortfolioRunEligibilityError(
        "STRATEGY_UNAVAILABLE",
        `${leg.strategyCode}@${leg.strategyVersion} is not active.`,
      );
    }
    if (customRule && !currencyMatchesRule(asset.currency, customRule.currency)) {
      throw new PortfolioRunEligibilityError(
        "STRATEGY_UNSUPPORTED",
        `${leg.strategyCode}@${leg.strategyVersion} expects ${customRule.currency} market data.`,
      );
    }
    const strategyMarkets = stringArray(strategy.supportedMarkets);
    const strategyTimeframes = stringArray(strategy.supportedTimeframes);
    if (!strategyMarkets.includes(market) || !strategyTimeframes.includes(input.timeframe)) {
      throw new PortfolioRunEligibilityError(
        "STRATEGY_UNSUPPORTED",
        `${leg.strategyCode}@${leg.strategyVersion} does not support ${leg.symbol}.`,
      );
    }
    const maximumLeverage = Math.min(Number(asset.maxLeverage), MARKET_LEVERAGE_CAP[market]);
    if (!Number.isFinite(maximumLeverage) || leg.leverage > maximumLeverage) {
      throw new PortfolioRunEligibilityError(
        "LEVERAGE_LIMIT_EXCEEDED",
        `${leg.symbol} leverage exceeds ${maximumLeverage}.`,
      );
    }
    void input.assumptions.marketCosts[market];
    return {
      symbol: leg.symbol,
      assetId: asset.id,
      datasetVersionId: dataset.id,
      datasetChecksum: dataset.checksum,
      strategyVersionId: strategy.id,
      implementationHash: strategy.implementationHash,
      allocationBps: leg.allocationBps,
      leverage: leg.leverage,
      strategyParameters: customRule ?? leg.strategyParameters,
      initialNotional: notionalFromBps(input.totalCapital, leg.allocationBps),
      market,
      currency: asset.currency,
      strategyCode: leg.strategyCode,
      strategyVersion: leg.strategyVersion,
      listingFirstObservedAt: asset.listingPeriods[0]?.validFrom.toISOString() ?? null,
    };
  });
}

const runInclude = (organizationId: string) =>
  ({
    strategyVersion: { select: { code: true, version: true } },
    legs: {
      orderBy: { symbolSnapshot: "asc" as const },
      include: {
        strategyVersion: { select: { code: true, version: true, name: true } },
      },
    },
    artifacts: {
      where: { organizationId },
      orderBy: [{ scopeKey: "asc" as const }, { kind: "asc" as const }],
    },
  }) satisfies Prisma.QuantRunInclude;

type QuantRunRecord = Prisma.QuantRunGetPayload<{ include: ReturnType<typeof runInclude> }>;

type RunClient = Pick<ReturnType<typeof getPrisma>, "quantRun">;

async function loadRunWithClient(client: RunClient, organizationId: string, id: string) {
  const run = await client.quantRun.findFirst({
    where: { id, organizationId },
    include: runInclude(organizationId),
  });
  if (!run) throw new Error("Quant run not found.");
  return quantRunToResponse(run);
}

export async function createPortfolioQuantRun(
  context: TenantContext,
  input: PortfolioBacktestSubmission,
) {
  const normalizedInput = normalizeBacktestSubmission(input);
  const resolvedLegs = await resolvePortfolioLegs(context, normalizedInput);
  const listingStarts = resolvedLegs
    .map((leg) => leg.listingFirstObservedAt)
    .filter((value): value is string => value !== null)
    .sort();
  const firstObservedAt =
    listingStarts.length === resolvedLegs.length ? (listingStarts.at(-1) ?? null) : null;
  const historicalCoverage = {
    firstObservedAt,
    completeForRequestedRange: Boolean(
      firstObservedAt && dateBoundary(normalizedInput.from) >= new Date(firstObservedAt),
    ),
    warningCode: null as "SURVIVORSHIP_COVERAGE_PARTIAL" | null,
  };
  if (!historicalCoverage.completeForRequestedRange) {
    historicalCoverage.warningCode = "SURVIVORSHIP_COVERAGE_PARTIAL";
  }
  const portfolioHash = hashResolvedPortfolioRun(
    normalizedInput,
    resolvedLegs,
    PORTFOLIO_ENGINE_VERSION,
  );
  const datasetVersionIds = resolvedLegs.map((leg) => leg.datasetVersionId);
  return getPrisma().$transaction(async (tx) => {
    const lockKey = `${context.organizationId}:${PORTFOLIO_ENGINE_VERSION}:${portfolioHash}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const cached = await tx.quantRun.findFirst({
      where: {
        organizationId: context.organizationId,
        status: { in: ["queued", "running", "succeeded"] },
        strategyHash: portfolioHash,
        engineVersion: PORTFOLIO_ENGINE_VERSION,
      },
      orderBy: [{ status: "desc" }, { finishedAt: "desc" }, { createdAt: "desc" }],
      include: runInclude(context.organizationId),
    });
    if (cached) {
      const response = quantRunToResponse(cached);
      return cached.status === "succeeded"
        ? { ...response, cacheHit: true, sourceRunId: cached.id }
        : response;
    }
    const run = await tx.quantRun.create({
      data: {
        organizationId: context.organizationId,
        userId: context.userId,
        strategyVersionId: null,
        strategyName: "Portfolio Backtest",
        status: "queued",
        timeframe: normalizedInput.timeframe,
        progress: 0,
        strategyHash: portfolioHash,
        datasetVersionIds: datasetVersionIds as Prisma.InputJsonValue,
        engineVersion: PORTFOLIO_ENGINE_VERSION,
        deadlineAt: new Date(Date.now() + RUN_TIMEOUT_MS),
        parameters: { ...normalizedInput, historicalCoverage } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await tx.quantRunLeg.createMany({
      data: resolvedLegs.map((leg) => ({
        quantRunId: run.id,
        assetId: leg.assetId,
        datasetVersionId: leg.datasetVersionId,
        strategyVersionId: leg.strategyVersionId,
        symbolSnapshot: leg.symbol,
        marketSnapshot: leg.market,
        currencySnapshot: leg.currency,
        allocationBps: leg.allocationBps,
        initialNotional: leg.initialNotional,
        leverage: leg.leverage,
        parameters: leg.strategyParameters as Prisma.InputJsonValue,
        implementationHash: leg.implementationHash,
      })),
    });
    return loadRunWithClient(tx, context.organizationId, run.id);
  });
}

export async function listPortfolioQuantRuns(context: TenantContext) {
  const runs = await getPrisma().quantRun.findMany({
    where: { organizationId: context.organizationId },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: runInclude(context.organizationId),
  });
  return runs.map(quantRunToResponse);
}

export function loadPortfolioQuantRun(context: TenantContext, id: string) {
  return loadRunWithClient(getPrisma(), context.organizationId, id);
}

export async function cancelPortfolioQuantRun(context: TenantContext, id: string) {
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.quantRun.findFirst({
      where: { id, organizationId: context.organizationId },
      select: { status: true },
    });
    if (!existing) throw new Error("Quant run not found.");

    const requestedAt = new Date();
    if (existing.status === "queued") {
      const cancelled = await tx.quantRun.updateMany({
        where: { id, organizationId: context.organizationId, status: "queued" },
        data: {
          status: "cancelled",
          progress: 100,
          cancelRequestedAt: requestedAt,
          finishedAt: requestedAt,
          leaseExpiresAt: null,
        },
      });
      if (cancelled.count > 0) {
        await tx.quantRunLeg.updateMany({
          where: { quantRunId: id, status: "queued" },
          data: { status: "cancelled", progress: 100 },
        });
      } else {
        await tx.quantRun.updateMany({
          where: { id, organizationId: context.organizationId, status: "running" },
          data: { status: "cancel_requested", cancelRequestedAt: requestedAt },
        });
      }
    } else if (existing.status === "running") {
      await tx.quantRun.updateMany({
        where: { id, organizationId: context.organizationId, status: "running" },
        data: { status: "cancel_requested", cancelRequestedAt: requestedAt },
      });
    }
    return loadRunWithClient(tx, context.organizationId, id);
  });
}

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

function quantRunStatus(value: string): QuantRunStatus {
  if (
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancel_requested" ||
    value === "cancelled" ||
    value === "timed_out"
  ) {
    return value;
  }
  throw new Error("Invalid quant run status returned from storage.");
}

function quantRunToResponse(run: QuantRunRecord): QuantRunResponse {
  return {
    id: run.id,
    strategyName: run.strategyName,
    strategyCode: run.strategyVersion?.code ?? null,
    strategyVersion: run.strategyVersion?.version ?? null,
    status: quantRunStatus(run.status),
    timeframe: run.timeframe === "1h" ? "1h" : "1d",
    progress: run.progress ?? 0,
    strategyHash: run.strategyHash ?? null,
    datasetVersionIds: stringArray(run.datasetVersionIds),
    engineVersion: run.engineVersion ?? "legacy-v1",
    parameters: objectJson(run.parameters),
    metrics: run.metrics === null ? null : objectJson(run.metrics),
    errorMessage: run.errorMessage ?? null,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt?.toISOString() ?? new Date(0).toISOString(),
    cacheHit: false,
    sourceRunId: null,
    legs: run.legs.map((leg) => ({
      id: leg.id,
      symbol: leg.symbolSnapshot,
      market: storedMarket(leg.marketSnapshot),
      currency: leg.currencySnapshot,
      allocationBps: leg.allocationBps,
      initialNotional: numberFromDecimal(leg.initialNotional),
      leverage: numberFromDecimal(leg.leverage),
      strategyCode: leg.strategyVersion.code,
      strategyVersion: leg.strategyVersion.version,
      strategyName: leg.strategyVersion.name,
      strategyParameters: objectJson(leg.parameters),
      implementationHash: leg.implementationHash,
      datasetVersionId: leg.datasetVersionId,
      status: quantRunStatus(leg.status),
      progress: leg.progress,
      metrics: leg.metrics === null ? null : objectJson(leg.metrics),
      errorCode: leg.errorCode,
    })),
    artifacts: run.artifacts.map((artifact) => ({
      id: artifact.id,
      quantRunLegId: artifact.quantRunLegId ?? null,
      scopeKey: artifact.scopeKey ?? "aggregate",
      kind: artifactKind(artifact.kind),
      checksum: artifact.checksum,
      payload: artifact.payload,
      rowCount: artifact.rowCount,
      schemaVersion: artifact.schemaVersion,
    })),
  };
}
