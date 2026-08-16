import type { TenantContext } from "@/lib/auth/tenant-context";
import { getPrisma } from "@/lib/db/prisma";

import { numberFromDecimal } from "./db-mappers";
import {
  assertAssetClass,
  latestBarsByAssetId,
  loadActiveMarketBarsForAssets,
  preferActiveDatasetBars,
} from "./market-repository";
import {
  buildPortfolioResponse,
  buildTradeAwarePerformance,
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
  TransactionType,
} from "./types";

const TIMEFRAME_LIMITS = {
  "1W": 7,
  "1M": 30,
  YTD: 90,
  "1Y": 252,
} as const;

function assertTransactionType(value: string): TransactionType {
  if (value === "buy" || value === "sell") return value;
  throw new Error(`Unsupported portfolio transaction type: ${value}.`);
}

export async function loadPortfolioResponse(
  context: TenantContext,
  timeframe: PortfolioTimeframe = "1M",
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

  if (!portfolio) {
    throw new Error("Portfolio not found.");
  }

  const assetIds = Array.from(
    new Set(portfolio.transactions.map((transaction) => transaction.assetId)),
  );
  const benchmark = await prisma.asset.findUnique({
    where: { symbol: "VNINDEX" },
    select: { id: true },
  });
  const barAssetIds = Array.from(new Set([...assetIds, ...(benchmark ? [benchmark.id] : [])]));
  const bars = await prisma.marketBar.findMany({
    where: { assetId: { in: barAssetIds }, timeframe: "1d" },
    orderBy: [{ assetId: "asc" }, { ts: "asc" }],
  });
  const datasetBars = await loadActiveMarketBarsForAssets(prisma, {
    assetIds: barAssetIds,
    timeframe: "1d",
  });
  const priceBars = preferActiveDatasetBars(datasetBars, bars);
  const latestBars = latestBarsByAssetId(priceBars);

  const transactions: PortfolioLedgerTransaction[] = portfolio.transactions.map((transaction) => ({
    id: transaction.id,
    createdAt: transaction.createdAt.toISOString(),
    type: assertTransactionType(transaction.type),
    assetId: transaction.assetId,
    symbol: transaction.asset.symbol,
    quantity: numberFromDecimal(transaction.quantity),
    price: numberFromDecimal(transaction.price),
    fee: numberFromDecimal(transaction.fee),
    executedAt: transaction.executedAt.toISOString(),
    note: transaction.note,
  }));

  const latestTransactionPrices = new Map<string, number>();
  for (const transaction of transactions) {
    latestTransactionPrices.set(transaction.assetId, transaction.price);
  }
  const assetRows = new Map(
    portfolio.transactions.map((transaction) => [transaction.assetId, transaction.asset]),
  );
  const ledgerAssets: PortfolioLedgerAsset[] = Array.from(assetRows.entries()).map(
    ([assetId, asset]) => ({
      assetId,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: assertAssetClass(asset.assetClass),
      latestPrice: latestBars.get(assetId)?.close ?? latestTransactionPrices.get(assetId) ?? 0,
    }),
  );
  const ledger = replayPortfolioLedger({ assets: ledgerAssets, transactions });

  const historicalBars: PortfolioHistoricalBar[] = priceBars.map((bar) => ({
    assetId: bar.assetId,
    ts: bar.ts.toISOString(),
    close: numberFromDecimal(bar.close),
  }));
  const performance = buildTradeAwarePerformance({
    assets: ledgerAssets,
    transactions,
    bars: historicalBars,
    benchmarkAssetId: benchmark?.id ?? null,
    limit: TIMEFRAME_LIMITS[timeframe],
  });
  const latestAsOf = Array.from(latestBars.values()).sort(
    (a, b) => b.ts.getTime() - a.ts.getTime(),
  )[0];
  return buildPortfolioResponse({
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    baseCurrency: portfolio.baseCurrency,
    positions: ledger.positions,
    transactions: [...ledger.transactions].reverse().slice(0, 100),
    performance,
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

export async function createPortfolioTransaction(
  context: TenantContext,
  input: PortfolioTransactionCreateInput,
) {
  const prisma = getPrisma();
  const symbol = input.symbol.trim().toUpperCase();
  const portfolio = await prisma.portfolio.findFirst({
    where: { organizationId: context.organizationId },
    select: { id: true, organizationId: true },
  });
  if (!portfolio) throw new Error("Portfolio not found.");

  const asset = await prisma.asset.findUnique({ where: { symbol } });
  if (!asset) throw new PortfolioInputError(`Asset ${symbol} not found.`, "ASSET_NOT_FOUND");
  if (!isSupportedPortfolioAsset(asset)) {
    throw new PortfolioInputError(
      `Asset ${symbol} is outside the supported Vietnam equity, crypto, and gold markets.`,
      "ASSET_UNSUPPORTED",
    );
  }

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
    await tx.portfolioTransaction.create({
      data: {
        portfolioId: portfolio.id,
        assetId: asset.id,
        type: input.type,
        quantity: input.quantity,
        price: input.price,
        fee: input.fee ?? 0,
        note: input.note,
        sourceSignalId: sourceSignal?.id,
        executedAt: input.executedAt ? new Date(input.executedAt) : new Date(),
      },
    });
    const rows = await tx.portfolioTransaction.findMany({
      where: { portfolioId: portfolio.id },
      include: { asset: true },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });

    const ledgerTransactions: PortfolioLedgerTransaction[] = rows.map((transaction) => ({
      id: transaction.id,
      createdAt: transaction.createdAt.toISOString(),
      type: assertTransactionType(transaction.type),
      assetId: transaction.assetId,
      symbol: transaction.asset.symbol,
      quantity: numberFromDecimal(transaction.quantity),
      price: numberFromDecimal(transaction.price),
      fee: numberFromDecimal(transaction.fee),
      executedAt: transaction.executedAt.toISOString(),
      note: transaction.note,
    }));
    const lastTransactionPrice = new Map<string, number>();
    for (const transaction of ledgerTransactions) {
      lastTransactionPrice.set(transaction.assetId, transaction.price);
    }
    const rowAssets = new Map(rows.map((transaction) => [transaction.assetId, transaction.asset]));
    const ledgerAssets: PortfolioLedgerAsset[] = Array.from(rowAssets.entries()).map(
      ([assetId, rowAsset]) => ({
        assetId,
        symbol: rowAsset.symbol,
        name: rowAsset.name,
        assetClass: assertAssetClass(rowAsset.assetClass),
        latestPrice: lastTransactionPrice.get(assetId) ?? 0,
      }),
    );
    const ledger = replayPortfolioLedger({
      assets: ledgerAssets,
      transactions: ledgerTransactions,
    });

    await tx.portfolioPosition.deleteMany({ where: { portfolioId: portfolio.id } });
    if (ledger.positions.length) {
      await tx.portfolioPosition.createMany({
        data: ledger.positions.map((position) => ({
          portfolioId: portfolio.id,
          assetId: position.assetId,
          quantity: position.quantity,
          averageCost: position.averageCost,
        })),
      });
    }
    if (sourceSignal) {
      await tx.strategySignal.update({
        where: { id: sourceSignal.id },
        data: { status: "executed", executionAt: new Date() },
      });
    }
  });

  return loadPortfolioResponse(context, input.timeframe ?? "1M");
}

export async function loadPortfolioPerformance(
  context: TenantContext,
  timeframe: PortfolioTimeframe,
) {
  const portfolio = await loadPortfolioResponse(context, timeframe);
  return portfolio.performance;
}

export function normalizePortfolioTimeframe(value: string | null): PortfolioTimeframe {
  return value === "1W" || value === "1M" || value === "YTD" || value === "1Y" ? value : "1M";
}
