import type { Prisma } from "@prisma/client";

import type { TenantContext } from "@/lib/auth/tenant-context";
import { getPrisma } from "@/lib/db/prisma";

import { numberFromDecimal } from "./db-mappers";
import { convertMoney, normalizeCurrency, selectRateOnOrBefore } from "./fx-rates";
import type { FxRatePoint, PortfolioCurrency, ResolvedFxRate } from "./fx-rates";
import {
  assertAssetClass,
  loadActiveMarketBarsForAssets,
  preferActiveDatasetBars,
} from "./market-repository";
import {
  buildPortfolioPerformance,
  buildPortfolioResponse,
  isSupportedPortfolioAsset,
  PortfolioDomainError,
  PortfolioInputError,
  replayPortfolioLedger,
} from "./portfolio";
import type {
  PortfolioHistoricalBar,
  PortfolioLedgerAsset,
  PortfolioLedgerTransaction,
  PortfolioResponse,
  PortfolioTimeframe,
  PortfolioTransactionCreateInput,
  PortfolioTransactionResponse,
  PortfolioTransactionUpdateInput,
  TransactionType,
} from "./types";

const TIMEFRAME_LIMITS = { "1W": 7, "1M": 30, YTD: 90, "1Y": 252 } as const;

function assertTransactionType(value: string): TransactionType {
  if (value === "buy" || value === "sell") return value;
  throw new Error(`Unsupported portfolio transaction type: ${value}.`);
}

function isoDate(value: Date | string) {
  return (typeof value === "string" ? value : value.toISOString()).slice(0, 10);
}

function transactionSnapshot(transaction: {
  fxRateToVnd: unknown;
  fxEffectiveDate: Date | null;
  fxSource: string | null;
  fxFallback: boolean;
}): ResolvedFxRate {
  const rate = numberFromDecimal(transaction.fxRateToVnd);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid transaction FX snapshot.");
  return {
    rate,
    effectiveDate: transaction.fxEffectiveDate?.toISOString().slice(0, 10) ?? null,
    source: transaction.fxSource ?? "fallback",
    fallback: transaction.fxFallback,
  };
}

function ratePoints(
  rows: Array<{ effectiveDate: Date; mid: unknown; source: string }>,
): FxRatePoint[] {
  return rows.map((row) => ({
    effectiveDate: isoDate(row.effectiveDate),
    rate: numberFromDecimal(row.mid),
    source: row.source,
  }));
}

function convertAt(value: number, from: string, to: PortfolioCurrency, rate: ResolvedFxRate) {
  return convertMoney(value, from, to, rate.rate);
}

export function normalizeNativeAssetPrice(
  asset: { market: string; assetClass: string; currency: string },
  value: number,
) {
  return asset.market === "vn_equity" && asset.assetClass === "equity" && asset.currency === "VND"
    ? value * 1_000
    : value;
}

async function latestFxSnapshot(
  tx: Prisma.TransactionClient,
  executedAt: Date,
): Promise<ResolvedFxRate> {
  const row = await tx.fxRate.findFirst({
    where: {
      baseCurrency: "USD",
      quoteCurrency: "VND",
      effectiveDate: { lte: executedAt },
    },
    orderBy: [{ effectiveDate: "desc" }, { fetchedAt: "desc" }],
  });
  if (!row) return selectRateOnOrBefore([], isoDate(executedAt));
  return {
    effectiveDate: isoDate(row.effectiveDate),
    rate: numberFromDecimal(row.mid),
    source: row.source,
    fallback: false,
  };
}

export async function rebuildPortfolioPositions(
  tx: Prisma.TransactionClient,
  portfolioId: string,
): Promise<void> {
  const rows = await tx.portfolioTransaction.findMany({
    where: { portfolioId },
    include: { asset: true },
    orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const transactions: PortfolioLedgerTransaction[] = rows.map((row) => {
    const snapshot = transactionSnapshot(row);
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      executedAt: row.executedAt.toISOString(),
      type: assertTransactionType(row.type),
      assetId: row.assetId,
      symbol: row.asset.symbol,
      quantity: numberFromDecimal(row.quantity),
      price: convertAt(numberFromDecimal(row.price), row.currency, "VND", snapshot),
      fee: convertAt(numberFromDecimal(row.fee), row.currency, "VND", snapshot),
      note: row.note,
      currency: "VND",
    };
  });
  const latestPrices = new Map<string, number>();
  for (const transaction of transactions) latestPrices.set(transaction.assetId, transaction.price);
  const assets = new Map(rows.map((row) => [row.assetId, row.asset]));
  const ledgerAssets: PortfolioLedgerAsset[] = Array.from(assets.entries()).map(
    ([assetId, asset]) => ({
      assetId,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: assertAssetClass(asset.assetClass),
      latestPrice: latestPrices.get(assetId) ?? 0,
      currency: "VND",
    }),
  );
  const ledger = replayPortfolioLedger({ assets: ledgerAssets, transactions });
  await tx.portfolioPosition.deleteMany({ where: { portfolioId } });
  if (ledger.positions.length) {
    await tx.portfolioPosition.createMany({
      data: ledger.positions.map((position) => ({
        portfolioId,
        assetId: position.assetId,
        quantity: position.quantity,
        averageCost: position.averageCost,
      })),
    });
  }
}

export async function loadPortfolioResponse(
  context: TenantContext,
  timeframe: PortfolioTimeframe = "1M",
  reportingCurrency: PortfolioCurrency = "USD",
): Promise<PortfolioResponse> {
  const prisma = getPrisma();
  const portfolio = await prisma.portfolio.findFirst({
    where: { organizationId: context.organizationId },
    include: {
      transactions: {
        include: { asset: true },
        orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!portfolio) throw new Error("Portfolio not found.");

  const assetIds = Array.from(new Set(portfolio.transactions.map((row) => row.assetId)));
  const benchmark = await prisma.asset.findUnique({
    where: { symbol: "VNINDEX" },
    select: { id: true },
  });
  const barAssetIds = Array.from(new Set([...assetIds, ...(benchmark ? [benchmark.id] : [])]));
  const [bars, datasetBars, fxRows] = await Promise.all([
    prisma.marketBar.findMany({
      where: { assetId: { in: barAssetIds }, timeframe: "1d" },
      orderBy: [{ assetId: "asc" }, { ts: "asc" }],
    }),
    loadActiveMarketBarsForAssets(prisma, { assetIds: barAssetIds, timeframe: "1d" }),
    prisma.fxRate.findMany({
      where: { baseCurrency: "USD", quoteCurrency: "VND" },
      orderBy: [{ effectiveDate: "asc" }, { fetchedAt: "asc" }],
    }),
  ]);
  const fx = ratePoints(fxRows);
  const rawPriceBars = preferActiveDatasetBars(datasetBars, bars);
  const assetRows = new Map(
    portfolio.transactions.map((transaction) => [transaction.assetId, transaction.asset]),
  );
  if (benchmark && !assetRows.has(benchmark.id)) {
    const benchmarkAsset = await prisma.asset.findUnique({ where: { id: benchmark.id } });
    if (benchmarkAsset) assetRows.set(benchmark.id, benchmarkAsset);
  }

  const convertedBars: PortfolioHistoricalBar[] = rawPriceBars.map((bar) => {
    const asset = assetRows.get(bar.assetId);
    if (!asset) throw new Error(`Asset metadata not found for ${bar.assetId}.`);
    return {
      assetId: bar.assetId,
      ts: bar.ts.toISOString(),
      close: convertAt(
        normalizeNativeAssetPrice(asset, numberFromDecimal(bar.close)),
        asset.currency,
        reportingCurrency,
        selectRateOnOrBefore(fx, isoDate(bar.ts)),
      ),
    };
  });
  const latestConvertedBars = new Map<string, PortfolioHistoricalBar>();
  for (const bar of convertedBars) latestConvertedBars.set(bar.assetId, bar);

  const rawMetadata = new Map<
    string,
    Pick<
      PortfolioTransactionResponse,
      | "rawPrice"
      | "rawFee"
      | "rawCurrency"
      | "fxRateToVnd"
      | "fxEffectiveDate"
      | "fxSource"
      | "fxFallback"
    >
  >();
  const transactions: PortfolioLedgerTransaction[] = portfolio.transactions.map((row) => {
    const snapshot = transactionSnapshot(row);
    const rawPrice = numberFromDecimal(row.price);
    const rawFee = numberFromDecimal(row.fee);
    rawMetadata.set(row.id, {
      rawPrice,
      rawFee,
      rawCurrency: normalizeCurrency(row.currency),
      fxRateToVnd: snapshot.rate,
      fxEffectiveDate: snapshot.effectiveDate,
      fxSource: snapshot.source,
      fxFallback: snapshot.fallback,
    });
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      executedAt: row.executedAt.toISOString(),
      type: assertTransactionType(row.type),
      assetId: row.assetId,
      symbol: row.asset.symbol,
      quantity: numberFromDecimal(row.quantity),
      price: convertAt(rawPrice, row.currency, reportingCurrency, snapshot),
      fee: convertAt(rawFee, row.currency, reportingCurrency, snapshot),
      note: row.note,
      currency: reportingCurrency,
    };
  });
  const latestTransactionPrices = new Map<string, number>();
  for (const transaction of transactions)
    latestTransactionPrices.set(transaction.assetId, transaction.price);
  const ledgerAssets: PortfolioLedgerAsset[] = Array.from(assetRows.entries())
    .filter(([assetId]) => assetIds.includes(assetId))
    .map(([assetId, asset]) => ({
      assetId,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: assertAssetClass(asset.assetClass),
      latestPrice:
        latestConvertedBars.get(assetId)?.close ?? latestTransactionPrices.get(assetId) ?? 0,
      currency: reportingCurrency,
    }));
  const ledger = replayPortfolioLedger({ assets: ledgerAssets, transactions });
  const performanceResult = buildPortfolioPerformance({
    assets: ledgerAssets,
    transactions,
    bars: convertedBars,
    benchmarkAssetId: benchmark?.id ?? null,
    limit: TIMEFRAME_LIMITS[timeframe],
  });
  const responseTransactions = ledger.transactions.map((transaction) => ({
    ...transaction,
    ...rawMetadata.get(transaction.id),
  }));
  const latestAsOf = [...rawPriceBars].sort((a, b) => b.ts.getTime() - a.ts.getTime())[0];
  return buildPortfolioResponse({
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    baseCurrency: reportingCurrency,
    positions: ledger.positions,
    transactions: responseTransactions.reverse().slice(0, 100),
    performance: performanceResult.performance,
    benchmark: performanceResult.benchmark,
    realizedPnL: ledger.realizedPnL,
    cumulativeBuyCapital: ledger.cumulativeBuyCapital,
    dataAsOf: latestAsOf?.ts.toISOString() ?? null,
    dataSource: latestAsOf?.source ?? "local",
  });
}

export function validateSourceSignalExecution(
  signal: {
    status: string;
    signalType: string;
    assetId: string;
    assignment: { portfolioId: string };
  },
  expected: { portfolioId: string; assetId: string; side: TransactionType },
) {
  if (signal.status === "executed" || signal.status === "dismissed") {
    throw new PortfolioDomainError("SIGNAL_ALREADY_ACTED", "SIGNAL_ALREADY_ACTED");
  }
  if (
    signal.assignment.portfolioId !== expected.portfolioId ||
    signal.assetId !== expected.assetId
  ) {
    throw new PortfolioDomainError("SIGNAL_SCOPE_MISMATCH", "SIGNAL_SCOPE_MISMATCH");
  }
  if (signal.signalType !== expected.side) {
    throw new PortfolioDomainError("SIGNAL_SIDE_MISMATCH", "SIGNAL_SIDE_MISMATCH");
  }
}

async function portfolioAndAsset(context: TenantContext, symbol: string) {
  const prisma = getPrisma();
  const portfolio = await prisma.portfolio.findFirst({
    where: { organizationId: context.organizationId },
    select: { id: true, organizationId: true },
  });
  if (!portfolio) throw new Error("Portfolio not found.");
  const asset = await prisma.asset.findUnique({ where: { symbol: symbol.trim().toUpperCase() } });
  if (!asset) throw new PortfolioInputError(`Asset ${symbol} not found.`, "ASSET_NOT_FOUND");
  if (!isSupportedPortfolioAsset(asset)) {
    throw new PortfolioInputError(
      `Asset ${symbol} is outside the supported markets.`,
      "ASSET_UNSUPPORTED",
    );
  }
  return { prisma, portfolio, asset };
}

export async function createPortfolioTransaction(
  context: TenantContext,
  input: PortfolioTransactionCreateInput,
) {
  const { prisma, portfolio, asset } = await portfolioAndAsset(context, input.symbol);
  const executedAt = input.executedAt ? new Date(input.executedAt) : new Date();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "portfolios" WHERE "id" = ${portfolio.id} FOR UPDATE`;
    let sourceSignal: {
      id: string;
      status: string;
      signalType: string;
      assetId: string;
      assignment: { portfolioId: string };
    } | null = null;
    if (input.sourceSignalId) {
      sourceSignal = await tx.strategySignal.findFirst({
        where: { id: input.sourceSignalId, organizationId: context.organizationId },
        select: {
          id: true,
          status: true,
          signalType: true,
          assetId: true,
          assignment: { select: { portfolioId: true } },
        },
      });
      if (!sourceSignal) {
        throw new PortfolioDomainError("SIGNAL_SCOPE_MISMATCH", "SIGNAL_SCOPE_MISMATCH");
      }
      validateSourceSignalExecution(sourceSignal, {
        portfolioId: portfolio.id,
        assetId: asset.id,
        side: input.type,
      });
    }
    const snapshot = await latestFxSnapshot(tx, executedAt);
    await tx.portfolioTransaction.create({
      data: {
        portfolioId: portfolio.id,
        assetId: asset.id,
        type: input.type,
        quantity: input.quantity,
        price: input.price,
        fee: input.fee ?? 0,
        currency: normalizeCurrency(input.currency ?? asset.currency),
        fxRateToVnd: snapshot.rate,
        fxEffectiveDate: snapshot.effectiveDate
          ? new Date(`${snapshot.effectiveDate}T00:00:00.000Z`)
          : null,
        fxSource: snapshot.source,
        fxFallback: snapshot.fallback,
        note: input.note,
        sourceSignalId: sourceSignal?.id,
        executedAt,
      },
    });
    await rebuildPortfolioPositions(tx, portfolio.id);
    if (sourceSignal) {
      await tx.strategySignal.update({
        where: { id: sourceSignal.id },
        data: { status: "executed", executionAt: new Date() },
      });
    }
  });
  return loadPortfolioResponse(context, input.timeframe ?? "1M", input.reportingCurrency ?? "USD");
}

export async function updatePortfolioTransaction(
  context: TenantContext,
  transactionId: string,
  input: PortfolioTransactionUpdateInput,
) {
  const { prisma, portfolio, asset } = await portfolioAndAsset(context, input.symbol);
  const existing = await prisma.portfolioTransaction.findFirst({
    where: { id: transactionId, portfolio: { organizationId: context.organizationId } },
    select: { id: true },
  });
  if (!existing) {
    throw new PortfolioInputError("Transaction not found.", "TRANSACTION_NOT_FOUND");
  }
  const executedAt = input.executedAt ? new Date(input.executedAt) : new Date();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "portfolios" WHERE "id" = ${portfolio.id} FOR UPDATE`;
    const snapshot = await latestFxSnapshot(tx, executedAt);
    await tx.portfolioTransaction.update({
      where: { id: existing.id },
      data: {
        assetId: asset.id,
        type: input.type,
        quantity: input.quantity,
        price: input.price,
        fee: input.fee ?? 0,
        currency: normalizeCurrency(input.currency ?? asset.currency),
        fxRateToVnd: snapshot.rate,
        fxEffectiveDate: snapshot.effectiveDate
          ? new Date(`${snapshot.effectiveDate}T00:00:00.000Z`)
          : null,
        fxSource: snapshot.source,
        fxFallback: snapshot.fallback,
        note: input.note,
        executedAt,
      },
    });
    await rebuildPortfolioPositions(tx, portfolio.id);
  });
  return loadPortfolioResponse(context, input.timeframe ?? "1M", input.reportingCurrency ?? "USD");
}

export async function deletePortfolioTransaction(
  context: TenantContext,
  transactionId: string,
  timeframe: PortfolioTimeframe,
  reportingCurrency: PortfolioCurrency,
) {
  const prisma = getPrisma();
  const existing = await prisma.portfolioTransaction.findFirst({
    where: { id: transactionId, portfolio: { organizationId: context.organizationId } },
    select: { id: true, portfolioId: true, sourceSignalId: true },
  });
  if (!existing) {
    throw new PortfolioInputError("Transaction not found.", "TRANSACTION_NOT_FOUND");
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "portfolios" WHERE "id" = ${existing.portfolioId} FOR UPDATE`;
    await tx.portfolioTransaction.delete({ where: { id: existing.id } });
    await rebuildPortfolioPositions(tx, existing.portfolioId);
    if (existing.sourceSignalId) {
      await tx.strategySignal.update({
        where: { id: existing.sourceSignalId },
        data: { status: "suggested", executionAt: null },
      });
    }
  });
  return loadPortfolioResponse(context, timeframe, reportingCurrency);
}

export async function loadPortfolioPerformance(
  context: TenantContext,
  timeframe: PortfolioTimeframe,
  reportingCurrency: PortfolioCurrency = "USD",
) {
  return (await loadPortfolioResponse(context, timeframe, reportingCurrency)).performance;
}

export function normalizePortfolioTimeframe(value: string | null): PortfolioTimeframe {
  return value === "1W" || value === "1M" || value === "YTD" || value === "1Y" ? value : "1M";
}

export function normalizeReportingCurrency(value: string | null): PortfolioCurrency {
  return value === "VND" ? "VND" : "USD";
}
