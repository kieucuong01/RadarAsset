import type { Prisma } from "@prisma/client";
import type { TenantContext } from "@/lib/auth/tenant-context";
import { getPrisma } from "@/lib/db/prisma";
import { buildAssetIntelligence } from "./investor-intelligence";
import { buildTickerResponse } from "./market";
import {
  buildPortfolioResponse,
  buildTradeAwarePerformance,
  PortfolioInputError,
  replayPortfolioLedger,
} from "./portfolio";
import type {
  AssetIntelligenceResponse,
  AssetClass,
  ForecastPointInput,
  InsightEvidenceInput,
  InvestmentThesisInput,
  InvestorInsightInput,
  MarketBarInput,
  MarketDataHealthItem,
  MarketDataMarket,
  MarketDataTimeframe,
  MarketIngestionStatus,
  MarketTickerResponse,
  PortfolioHistoricalBar,
  PortfolioLedgerAsset,
  PortfolioLedgerTransaction,
  PortfolioResponse,
  PortfolioTransactionCreateInput,
  PortfolioTimeframe,
  QuantRunResponse,
  QuantRunStatus,
  StrategyAssignmentCreateInput,
  StrategyAssignmentResponse,
  StrategySignalResponse,
  ResearchRunImportInput,
  ResearchRunResponse,
  TransactionType,
  WatchlistMutationInput,
} from "./types";
import type { BacktestSubmission } from "@/lib/backtest/contracts";
import { hashBacktestSubmission } from "@/lib/backtest/hash";
import { normalizeStrategyAssignment } from "@/lib/backtest/assignment-contracts";
import { calculateFreshness } from "@/lib/market-data/health";
import type { WorkerImportContext } from "./worker-context";
import { resolveProviderInstrument } from "./provider-catalog";
import { requestMarketIngestion } from "./ingestion-requests";

const TIMEFRAME_LIMITS = {
  "1W": 7,
  "1M": 30,
  YTD: 90,
  "1Y": 252,
} as const;

const MARKET_DATA_SYMBOLS = [
  "FPT",
  "VCB",
  "HPG",
  "VNM",
  "MWG",
  "SSI",
  "VIC",
  "BTC",
  "XAU",
] as const;
const MARKET_DATA_TIMEFRAMES = ["1d", "1h"] as const;
const ELIGIBLE_DATASET_QUALITY = ["passed", "warning"] as const;
const PUBLIC_MARKET_ERROR_CODES = new Set([
  "ingestion_failed",
  "invalid_response",
  "network_error",
  "provider_rejected",
  "provider_unavailable",
  "rate_limited",
  "response_limit",
  "stale_run",
  "unsupported_timeframe",
]);

function numberFromDecimal(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object" && "toString" in value) {
    return Number(value.toString());
  }
  return 0;
}

function assertAssetClass(value: string): AssetClass {
  const known = ["crypto", "equity", "etf", "index", "fx", "commodity", "cash"];
  return known.includes(value) ? (value as AssetClass) : "equity";
}

function assertTransactionType(value: string): TransactionType {
  if (value === "buy" || value === "sell") return value;
  throw new Error(`Unsupported portfolio transaction type: ${value}.`);
}

function assertQuantRunStatus(value: string): QuantRunStatus {
  if (value === "running" || value === "succeeded" || value === "failed") return value;
  return "queued";
}

function assertMarketDataMarket(value: string): MarketDataMarket {
  if (value === "vn_equity" || value === "crypto_spot" || value === "metal_spot") {
    return value;
  }
  throw new Error("Unsupported market data market.");
}

function marketIngestionStatus(value: string | undefined): MarketIngestionStatus | null {
  if (
    value === "running" ||
    value === "succeeded" ||
    value === "unchanged" ||
    value === "skipped" ||
    value === "failed" ||
    value === "unavailable"
  ) {
    return value;
  }
  return null;
}

function publicMarketErrorCode(value: string | null | undefined) {
  return value && PUBLIC_MARKET_ERROR_CODES.has(value) ? value : null;
}

function assertInsightSentiment(value: string): InvestorInsightInput["sentiment"] {
  if (value === "bull" || value === "bear") return value;
  return "neutral";
}

function assertThesisStance(value: string): InvestmentThesisInput["stance"] {
  if (
    value === "accumulate" ||
    value === "hold" ||
    value === "trim" ||
    value === "avoid" ||
    value === "watch"
  ) {
    return value;
  }
  return "watch";
}

function objectJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringArrayJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function relativeAge(date: Date): string {
  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function dayLabel(date: Date): string {
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);
  const key = date.toISOString().slice(0, 10);
  if (key === todayKey) return "Today";
  if (key === tomorrowKey) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

type ActiveDatasetBarRow = {
  assetId: string;
  asset: {
    id: string;
    symbol: string;
    name: string;
    assetClass: string;
  };
  ts: Date;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown | null;
  source: string;
};

async function loadActiveDatasetBars(
  prisma: ReturnType<typeof getPrisma>,
  input: {
    timeframe: string;
    assetIds?: string[];
    symbols?: string[];
    barLimit?: number;
  },
): Promise<ActiveDatasetBarRow[]> {
  const datasets = await prisma.dataset.findMany({
    where: {
      timeframe: input.timeframe,
      adjustmentPolicy: "raw",
      assetId: input.assetIds?.length ? { in: input.assetIds } : undefined,
      asset: input.symbols?.length ? { symbol: { in: input.symbols } } : undefined,
    },
    select: {
      assetId: true,
      asset: { select: { id: true, symbol: true, name: true, assetClass: true } },
      versions: {
        where: { isActive: true, qualityStatus: { in: [...ELIGIBLE_DATASET_QUALITY] } },
        orderBy: [{ version: "desc" }, { publishedAt: "desc" }],
        take: 1,
        select: {
          bars: {
            orderBy: { ts: input.barLimit ? "desc" : "asc" },
            take: input.barLimit,
            select: {
              ts: true,
              open: true,
              high: true,
              low: true,
              close: true,
              volume: true,
              source: true,
            },
          },
        },
      },
    },
  });

  return datasets
    .flatMap((dataset) =>
      (dataset.versions[0]?.bars ?? []).map((bar) => ({
        assetId: dataset.assetId,
        asset: dataset.asset,
        ...bar,
      })),
    )
    .sort((left, right) => {
      const assetOrder = left.assetId.localeCompare(right.assetId);
      if (assetOrder !== 0) return assetOrder;
      return left.ts.getTime() - right.ts.getTime();
    });
}

function preferActiveDatasetBars<
  TMarketBar extends {
    assetId: string;
    ts: Date;
    close: unknown;
    volume: unknown | null;
    source?: string;
  },
>(datasetBars: ActiveDatasetBarRow[], marketBars: TMarketBar[]) {
  if (!datasetBars.length) return marketBars;
  const datasetAssetIds = new Set(datasetBars.map((bar) => bar.assetId));
  return [
    ...datasetBars,
    ...marketBars.filter((bar) => !datasetAssetIds.has(bar.assetId)),
  ].sort((left, right) => {
    const assetOrder = left.assetId.localeCompare(right.assetId);
    if (assetOrder !== 0) return assetOrder;
    return left.ts.getTime() - right.ts.getTime();
  });
}

function latestBarsByAssetId(
  bars: {
    assetId: string;
    close: unknown;
    ts: Date;
    volume: unknown | null;
    source?: string;
  }[],
) {
  const map = new Map<
    string,
    { close: number; ts: Date; volume: number | null; source: string | null }
  >();
  for (const bar of bars) {
    const current = map.get(bar.assetId);
    if (!current || bar.ts > current.ts) {
      map.set(bar.assetId, {
        close: numberFromDecimal(bar.close),
        ts: bar.ts,
        volume: bar.volume === null ? null : numberFromDecimal(bar.volume),
        source: bar.source ?? null,
      });
    }
  }
  return map;
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
    where: { symbol: "SPY" },
    select: { id: true },
  });
  const barAssetIds = Array.from(new Set([...assetIds, ...(benchmark ? [benchmark.id] : [])]));
  const bars = await prisma.marketBar.findMany({
    where: { assetId: { in: barAssetIds }, timeframe: "1d" },
    orderBy: [{ assetId: "asc" }, { ts: "asc" }],
  });
  const datasetBars = await loadActiveDatasetBars(prisma, {
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

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "portfolios" WHERE "id" = ${portfolio.id} FOR UPDATE`;
    await tx.portfolioTransaction.create({
      data: {
        portfolioId: portfolio.id,
        assetId: asset.id,
        type: input.type,
        quantity: input.quantity,
        price: input.price,
        fee: input.fee ?? 0,
        note: input.note,
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

export async function loadAssets() {
  const prisma = getPrisma();
  const assets = await prisma.asset.findMany({
    orderBy: [{ assetClass: "asc" }, { symbol: "asc" }],
    select: {
      id: true,
      symbol: true,
      name: true,
      assetClass: true,
      currency: true,
      provider: true,
      providerSymbol: true,
      datasets: {
        where: { adjustmentPolicy: "raw" },
        select: {
          versions: {
            where: { isActive: true, qualityStatus: { in: [...ELIGIBLE_DATASET_QUALITY] } },
            select: { id: true, rowCount: true },
            take: 1,
          },
        },
      },
    },
  });
  const priority = (assetClass: string) => {
    if (assetClass === "equity") return 0;
    if (assetClass === "commodity") return 1;
    if (assetClass === "crypto") return 2;
    return 3;
  };
  return assets
    .sort((left, right) => {
      const leftReady = left.datasets.some((dataset) => dataset.versions.length > 0);
      const rightReady = right.datasets.some((dataset) => dataset.versions.length > 0);
      if (leftReady !== rightReady) return leftReady ? -1 : 1;
      const classRank = priority(left.assetClass) - priority(right.assetClass);
      if (classRank !== 0) return classRank;
      const leftRows = left.datasets.reduce(
        (total, dataset) => total + (dataset.versions[0]?.rowCount ?? 0),
        0,
      );
      const rightRows = right.datasets.reduce(
        (total, dataset) => total + (dataset.versions[0]?.rowCount ?? 0),
        0,
      );
      if (leftRows !== rightRows) return rightRows - leftRows;
      return left.symbol.localeCompare(right.symbol);
    })
    .map(({ datasets, ...asset }) => asset);
}

export async function loadTickerResponse(symbols?: string[]): Promise<MarketTickerResponse[]> {
  const prisma = getPrisma();
  const marketBars = await prisma.marketBar.findMany({
    where: {
      timeframe: "1d",
      asset: symbols?.length ? { symbol: { in: symbols } } : undefined,
    },
    include: { asset: true },
    orderBy: [{ assetId: "asc" }, { ts: "asc" }],
  });
  const datasetBars = await loadActiveDatasetBars(prisma, {
    timeframe: "1d",
    symbols,
    barLimit: 2,
  });
  const bars = preferActiveDatasetBars(datasetBars, marketBars);

  const inputs: MarketBarInput[] = bars.map((bar) => ({
    symbol: bar.asset.symbol,
    name: bar.asset.name,
    assetClass: assertAssetClass(bar.asset.assetClass),
    ts: bar.ts.toISOString(),
    close: numberFromDecimal(bar.close),
    volume: bar.volume === null ? null : numberFromDecimal(bar.volume),
  }));

  return buildTickerResponse(inputs).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function loadMarketBars(symbol: string, timeframe = "1d") {
  const prisma = getPrisma();
  const asset = await prisma.asset.findUnique({
    where: { symbol: symbol.trim().toUpperCase() },
    select: { id: true, symbol: true, name: true, assetClass: true },
  });
  if (!asset) throw new Error(`Asset ${symbol} not found.`);

  const bars = await prisma.marketBar.findMany({
    where: { assetId: asset.id, timeframe },
    orderBy: { ts: "asc" },
  });
  const datasetBars = await loadActiveDatasetBars(prisma, {
    assetIds: [asset.id],
    timeframe,
  });
  const priceBars = datasetBars.length ? datasetBars : bars;

  return {
    asset,
    timeframe,
    bars: priceBars.map((bar) => ({
      ts: bar.ts.toISOString(),
      open: numberFromDecimal(bar.open),
      high: numberFromDecimal(bar.high),
      low: numberFromDecimal(bar.low),
      close: numberFromDecimal(bar.close),
      volume: bar.volume === null ? null : numberFromDecimal(bar.volume),
      source: bar.source,
    })),
  };
}

export async function loadInsights() {
  const prisma = getPrisma();
  const insights = await prisma.aiInsight.findMany({
    where: { researchRunId: null },
    include: { asset: true, evidenceItems: { select: { id: true } } },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  return insights.map((insight) => ({
    id: insight.id,
    source: insight.source,
    asset: insight.asset?.symbol ?? "Macro",
    sentiment: assertInsightSentiment(insight.sentiment),
    title: insight.title,
    summary: insight.summary,
    confidence: insight.confidence ?? 50,
    catalyst: insight.catalyst,
    risk: insight.risk,
    evidenceCount: insight.evidenceItems.length,
    publishedAt: insight.publishedAt.toISOString(),
    ago: relativeAge(insight.publishedAt),
  }));
}

export async function loadAssetIntelligence(symbol: string): Promise<AssetIntelligenceResponse> {
  const prisma = getPrisma();
  const normalized = symbol.trim().toUpperCase();
  const asset = await prisma.asset.findUnique({
    where: { symbol: normalized },
    select: { id: true, symbol: true, name: true },
  });
  if (!asset) throw new Error(`Asset ${normalized} not found.`);

  const [latestBar, insights, evidence, thesis, forecasts] = await Promise.all([
    prisma.marketBar.findFirst({
      where: { assetId: asset.id, timeframe: "1d" },
      orderBy: { ts: "desc" },
      select: { close: true },
    }),
    prisma.aiInsight.findMany({
      where: { assetId: asset.id, researchRunId: null },
      orderBy: { publishedAt: "desc" },
      take: 12,
    }),
    prisma.evidenceItem.findMany({
      where: { assetId: asset.id, researchRunId: null },
      orderBy: { observedAt: "desc" },
      take: 20,
    }),
    prisma.investmentThesis.findFirst({
      where: { assetId: asset.id, researchRunId: null },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.forecastPoint.findMany({
      where: { assetId: asset.id, researchRunId: null },
      orderBy: [{ generatedAt: "desc" }, { horizon: "asc" }],
      take: 8,
    }),
  ]);

  return buildAssetIntelligence({
    symbol: asset.symbol,
    name: asset.name,
    latestPrice: latestBar ? numberFromDecimal(latestBar.close) : 0,
    insights: insights.map((insight) => insightToInvestorInput({ ...insight, asset })),
    evidence: evidence.map(evidenceToInput),
    thesis: thesis ? thesisToInput(thesis, asset.symbol) : null,
    forecasts: forecasts.map(forecastToInput),
  });
}

export async function loadEvents() {
  const prisma = getPrisma();
  const events = await prisma.economicEvent.findMany({
    orderBy: { eventAt: "asc" },
    take: 50,
  });

  return events.map((event) => ({
    id: event.id,
    country: event.country,
    event: event.event,
    impact: event.impact,
    forecast: event.forecast,
    previous: event.previous,
    eventAt: event.eventAt.toISOString(),
    date: dayLabel(event.eventAt),
    time: event.eventAt.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }),
  }));
}

export async function loadWatchlist(context: TenantContext) {
  const prisma = getPrisma();
  const [items, tickers, insights, ingestionRequests] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: {
        organizationId: context.organizationId,
        userId: context.userId,
      },
      include: {
        asset: {
          include: {
            datasets: {
              select: {
                timeframe: true,
                versions: {
                  where: { isActive: true, qualityStatus: { in: [...ELIGIBLE_DATASET_QUALITY] } },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    loadTickerResponse(),
    prisma.aiInsight.findMany({
      where: {
        OR: [{ researchRunId: null }, { researchRun: { organizationId: context.organizationId } }],
      },
      include: { asset: true },
      orderBy: { publishedAt: "desc" },
    }),
    prisma.marketIngestionRequest.findMany({
      where: {
        organizationId: context.organizationId,
        userId: context.userId,
        status: { in: ["queued", "running"] },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        providerInstrument: { select: { assetId: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const tickerBySymbol = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
  const sentimentBySymbol = new Map<string, string>();
  const activeRequestByAsset = new Map<string, (typeof ingestionRequests)[number]>();
  for (const request of ingestionRequests) {
    if (!activeRequestByAsset.has(request.providerInstrument.assetId)) {
      activeRequestByAsset.set(request.providerInstrument.assetId, request);
    }
  }
  for (const insight of insights) {
    if (insight.asset?.symbol && !sentimentBySymbol.has(insight.asset.symbol)) {
      sentimentBySymbol.set(insight.asset.symbol, insight.sentiment);
    }
  }

  return items.map((item) => {
    const ticker = tickerBySymbol.get(item.asset.symbol);
    const backtestableTimeframes = item.asset.datasets
      .filter((dataset) => dataset.versions.length > 0)
      .map((dataset) => dataset.timeframe)
      .filter((timeframe): timeframe is "1d" | "1h" => timeframe === "1d" || timeframe === "1h")
      .sort();
    const activeRequest = activeRequestByAsset.get(item.asset.id);
    const datasetState = activeRequest
      ? "loading"
      : backtestableTimeframes.length > 0
        ? "ready"
        : item.asset.datasets.length > 0
          ? "stale"
          : "unavailable";
    return {
      id: item.id,
      sym: item.asset.symbol,
      name: item.asset.name,
      price: ticker?.price ?? 0,
      chg: ticker?.changePercent ?? 0,
      alert: item.alert === null ? 0 : numberFromDecimal(item.alert),
      sentiment: sentimentBySymbol.get(item.asset.symbol) ?? "neutral",
      datasetState,
      ingestionRequestId: activeRequest?.id ?? null,
      backtestableTimeframes,
    };
  });
}

export async function loadResearchRuns(context: TenantContext): Promise<ResearchRunResponse[]> {
  const prisma = getPrisma();
  const runs = await prisma.researchRun.findMany({
    where: { organizationId: context.organizationId },
    include: { asset: { select: { symbol: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return runs.map(researchRunToResponse);
}

export async function importResearchRun(
  context: WorkerImportContext,
  input: ResearchRunImportInput,
): Promise<ResearchRunResponse> {
  const prisma = getPrisma();
  const asset = input.symbol
    ? await prisma.asset.findUnique({
        where: { symbol: input.symbol.trim().toUpperCase() },
        select: { id: true, symbol: true },
      })
    : null;
  if (input.symbol && !asset) throw new Error(`Asset ${input.symbol} not found.`);

  const run = await prisma.$transaction(async (tx) => {
    const createdRun = await tx.researchRun.create({
      data: {
        organizationId: context.organizationId,
        userId: context.userId,
        assetId: asset?.id,
        source: input.source,
        kind: input.kind,
        status: input.status ?? "succeeded",
        summary: input.summary ?? null,
        parameters: (input.parameters ?? {}) as Prisma.InputJsonValue,
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
        finishedAt: input.finishedAt ? new Date(input.finishedAt) : null,
      },
    });

    for (const provider of input.providerRuns ?? []) {
      await tx.providerRun.create({
        data: {
          researchRunId: createdRun.id,
          provider: provider.provider,
          status: provider.status,
          recordsFetched: provider.recordsFetched ?? 0,
          errorMessage: provider.errorMessage ?? null,
          startedAt: provider.startedAt ? new Date(provider.startedAt) : null,
          finishedAt: provider.finishedAt ? new Date(provider.finishedAt) : null,
        },
      });
    }

    const createdInsights: { id: string }[] = [];
    for (const insight of input.insights ?? []) {
      createdInsights.push(
        await tx.aiInsight.create({
          data: {
            assetId: asset?.id,
            researchRunId: createdRun.id,
            source: insight.source ?? input.source,
            title: insight.title,
            summary: insight.summary,
            sentiment: insight.sentiment,
            confidence: insight.confidence ?? 50,
            catalyst: insight.catalyst ?? null,
            risk: insight.risk ?? null,
            publishedAt: insight.publishedAt ? new Date(insight.publishedAt) : new Date(),
          },
          select: { id: true },
        }),
      );
    }

    for (const evidence of input.evidence ?? []) {
      await tx.evidenceItem.create({
        data: {
          researchRunId: createdRun.id,
          assetId: asset?.id,
          insightId: createdInsights[0]?.id,
          sourceType: evidence.sourceType,
          sourceName: evidence.sourceName,
          url: evidence.url ?? null,
          title: evidence.title,
          excerpt: evidence.excerpt,
          engagement: evidence.engagement ?? 0,
          observedAt: evidence.observedAt ? new Date(evidence.observedAt) : new Date(),
        },
      });
    }

    if (input.thesis && asset) {
      await tx.investmentThesis.create({
        data: {
          assetId: asset.id,
          researchRunId: createdRun.id,
          source: input.source,
          stance: input.thesis.stance,
          conviction: input.thesis.conviction,
          thesis: input.thesis.thesis,
          bullCase: input.thesis.bullCase,
          bearCase: input.thesis.bearCase,
          actionItems: input.thesis.actionItems as Prisma.InputJsonValue,
        },
      });
    }

    if (asset) {
      for (const forecast of input.forecasts ?? []) {
        await tx.forecastPoint.create({
          data: {
            assetId: asset.id,
            researchRunId: createdRun.id,
            horizon: forecast.horizon,
            targetPrice: forecast.targetPrice,
            lowerBound: forecast.lowerBound,
            upperBound: forecast.upperBound,
            confidence: forecast.confidence,
            model: forecast.model,
            generatedAt: forecast.generatedAt ? new Date(forecast.generatedAt) : new Date(),
          },
        });
      }
    }

    return tx.researchRun.findUniqueOrThrow({
      where: { id: createdRun.id },
      include: { asset: { select: { symbol: true } } },
    });
  });

  return researchRunToResponse(run);
}

export async function upsertWatchlistItem(context: TenantContext, input: WatchlistMutationInput) {
  const prisma = getPrisma();
  const instrument =
    input.providerCode && input.providerSymbol
      ? await resolveProviderInstrument(input.providerCode, input.providerSymbol)
      : null;
  const symbol = instrument?.symbol ?? input.symbol?.trim().toUpperCase();
  if (!symbol) throw new Error("A system asset or provider instrument is required.");
  const asset = instrument
    ? { id: instrument.assetId }
    : await prisma.asset.findUnique({ where: { symbol }, select: { id: true } });
  if (!asset) throw new Error(`Asset ${symbol} not found.`);

  await prisma.watchlistItem.upsert({
    where: {
      organizationId_userId_assetId: {
        organizationId: context.organizationId,
        userId: context.userId,
        assetId: asset.id,
      },
    },
    create: {
      organizationId: context.organizationId,
      userId: context.userId,
      assetId: asset.id,
      alert: input.alert ?? null,
    },
    update: {
      alert: input.alert ?? null,
    },
  });

  if (instrument) {
    const requested = [...new Set(input.requestedTimeframes ?? instrument.supportedTimeframes)];
    const supported = requested.filter((timeframe) =>
      instrument.supportedTimeframes.includes(timeframe),
    );
    const ready = await prisma.dataset.findMany({
      where: {
        assetId: instrument.assetId,
        timeframe: { in: supported },
        adjustmentPolicy: "raw",
        versions: {
          some: { isActive: true, qualityStatus: { in: [...ELIGIBLE_DATASET_QUALITY] } },
        },
      },
      select: { timeframe: true },
    });
    const readyTimeframes = new Set(ready.map((dataset) => dataset.timeframe));
    await Promise.all(
      supported
        .filter((timeframe) => !readyTimeframes.has(timeframe))
        .map((timeframe) =>
          requestMarketIngestion(context, {
            providerCode: instrument.providerCode,
            providerSymbol: instrument.providerSymbol,
            timeframe,
          }),
        ),
    );
  }

  return loadWatchlist(context);
}

export async function removeWatchlistItem(context: TenantContext, id: string) {
  const result = await getPrisma().watchlistItem.deleteMany({
    where: { id, organizationId: context.organizationId, userId: context.userId },
  });
  return result.count === 1;
}

export async function loadMarketDataHealth(now = new Date()): Promise<MarketDataHealthItem[]> {
  const prisma = getPrisma();
  const [assets, recentRuns] = await Promise.all([
    prisma.asset.findMany({
      where: { symbol: { in: [...MARKET_DATA_SYMBOLS] } },
      select: {
        symbol: true,
        market: true,
        datasets: {
          where: {
            timeframe: { in: [...MARKET_DATA_TIMEFRAMES] },
            adjustmentPolicy: "raw",
          },
          select: {
            timeframe: true,
            versions: {
              where: { isActive: true },
              orderBy: { publishedAt: "desc" },
              take: 1,
              select: {
                id: true,
                version: true,
                rowCount: true,
                coverageStart: true,
                coverageEnd: true,
                publishedAt: true,
                sourceMetadata: true,
                provider: { select: { code: true, name: true } },
                bars: {
                  orderBy: { ts: "desc" },
                  take: 1,
                  select: { source: true },
                },
              },
            },
          },
        },
      },
    }),
    prisma.marketIngestionRun.findMany({
      where: {
        assetSymbol: { in: [...MARKET_DATA_SYMBOLS] },
        timeframe: { in: [...MARKET_DATA_TIMEFRAMES] },
      },
      orderBy: { startedAt: "desc" },
      take: 100,
      select: {
        assetSymbol: true,
        timeframe: true,
        status: true,
        errorCode: true,
      },
    }),
  ]);

  const assetBySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));
  const latestRunByFeed = new Map<string, (typeof recentRuns)[number]>();
  for (const run of recentRuns) {
    const key = `${run.assetSymbol}:${run.timeframe}`;
    if (!latestRunByFeed.has(key)) latestRunByFeed.set(key, run);
  }

  return MARKET_DATA_TIMEFRAMES.flatMap((timeframe) =>
    MARKET_DATA_SYMBOLS.map((symbol): MarketDataHealthItem => {
      const asset = assetBySymbol.get(symbol);
      const market = asset ? assertMarketDataMarket(asset.market) : marketForSymbol(symbol);
      const dataset = asset?.datasets.find((item) => item.timeframe === timeframe);
      const version = dataset?.versions[0];
      const metadata = objectJson(version?.sourceMetadata);
      const lastRun = latestRunByFeed.get(`${symbol}:${timeframe}`);
      const lastStatus = marketIngestionStatus(lastRun?.status);
      const source =
        metadata.mode === "fixture" ? "research_fixture" : (version?.bars[0]?.source ?? null);
      const upstreamProvider =
        typeof metadata.upstreamProvider === "string" ? metadata.upstreamProvider : null;

      return {
        symbol,
        market,
        timeframe: timeframe as MarketDataTimeframe,
        providerCode: version?.provider.code ?? null,
        providerName: version?.provider.name ?? null,
        upstreamProvider,
        datasetVersionId: version?.id ?? null,
        version: version?.version ?? null,
        rowCount: version?.rowCount ?? 0,
        coverageStart: version?.coverageStart.toISOString() ?? null,
        coverageEnd: version?.coverageEnd.toISOString() ?? null,
        publishedAt: version?.publishedAt.toISOString() ?? null,
        lastIngestionStatus: lastStatus,
        lastErrorCode: publicMarketErrorCode(lastRun?.errorCode),
        freshness: calculateFreshness({
          market,
          timeframe: timeframe as MarketDataTimeframe,
          coverageEnd: version?.coverageEnd ?? null,
          source,
          lastStatus,
          now,
        }),
      };
    }),
  );
}

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
  asset: { symbol: string };
  strategyVersion: { code: string; version: string; name: string };
  signals: Array<Parameters<typeof strategySignalToResponse>[0]>;
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

function marketForSymbol(symbol: (typeof MARKET_DATA_SYMBOLS)[number]): MarketDataMarket {
  if (symbol === "FPT") return "vn_equity";
  if (symbol === "BTC") return "crypto_spot";
  return "metal_spot";
}

export async function createQuantRun(context: TenantContext, input: BacktestSubmission) {
  const prisma = getPrisma();
  const aggregateStrategy = input.legs[0];
  if (
    !aggregateStrategy ||
    input.legs.some(
      (leg) =>
        leg.strategyCode !== aggregateStrategy.strategyCode ||
        leg.strategyVersion !== aggregateStrategy.strategyVersion ||
        JSON.stringify(leg.strategyParameters) !==
          JSON.stringify(aggregateStrategy.strategyParameters),
    )
  ) {
    throw new Error(
      "Mixed per-asset strategies are not available until the portfolio runner is enabled.",
    );
  }
  const strategyVersion = await prisma.strategyVersion.findUnique({
    where: {
      code_version: {
        code: aggregateStrategy.strategyCode,
        version: aggregateStrategy.strategyVersion,
      },
    },
    select: { id: true, code: true, version: true, name: true },
  });
  if (!strategyVersion) {
    throw new Error(
      `Strategy ${aggregateStrategy.strategyCode}@${aggregateStrategy.strategyVersion} is not synchronized in the catalog.`,
    );
  }
  const symbols = input.legs.map((leg) => leg.symbol);
  const assets = await prisma.asset.findMany({
    where: { symbol: { in: symbols } },
    select: {
      symbol: true,
      maxLeverage: true,
      datasets: {
        where: { timeframe: input.timeframe, adjustmentPolicy: "raw" },
        select: {
          versions: {
            where: { isActive: true },
            select: { id: true },
          },
        },
      },
    },
  });
  const assetBySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));
  const datasetVersionIds: string[] = [];
  for (const leg of input.legs) {
    const asset = assetBySymbol.get(leg.symbol);
    const version = asset?.datasets[0]?.versions[0];
    if (!asset || !version) {
      throw new Error(
        `No active ${input.timeframe} research dataset is available for ${leg.symbol}.`,
      );
    }
    const databaseMaximum = Number(asset.maxLeverage);
    if (leg.leverage > databaseMaximum) {
      throw new Error(`${leg.symbol} leverage exceeds the configured product limit.`);
    }
    datasetVersionIds.push(version.id);
  }
  const run = await prisma.quantRun.create({
    data: {
      organizationId: context.organizationId,
      userId: context.userId,
      strategyVersionId: strategyVersion.id,
      strategyName: strategyVersion.name,
      status: "queued",
      timeframe: input.timeframe,
      progress: 0,
      strategyHash: hashBacktestSubmission(input),
      datasetVersionIds: datasetVersionIds as Prisma.InputJsonValue,
      engineVersion: `${aggregateStrategy.strategyCode}-v1`,
      parameters: input as Prisma.InputJsonValue,
    },
    include: {
      artifacts: true,
      strategyVersion: { select: { code: true, version: true } },
    },
  });
  return quantRunToResponse(run);
}

export async function listQuantRuns(context: TenantContext) {
  const prisma = getPrisma();
  const runs = await prisma.quantRun.findMany({
    where: { organizationId: context.organizationId },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: {
      artifacts: true,
      strategyVersion: { select: { code: true, version: true } },
    },
  });
  return runs.map(quantRunToResponse);
}

export async function getQuantRun(context: TenantContext, id: string) {
  const prisma = getPrisma();
  const run = await prisma.quantRun.findFirst({
    where: { id, organizationId: context.organizationId },
    include: {
      strategyVersion: { select: { code: true, version: true } },
      artifacts: {
        where: { organizationId: context.organizationId },
        orderBy: { kind: "asc" },
      },
    },
  });
  if (!run) throw new Error("Quant run not found.");
  return quantRunToResponse(run);
}

function quantRunToResponse(run: {
  id: string;
  strategyName: string;
  strategyVersion?: { code: string; version: string } | null;
  status: string;
  timeframe?: string;
  progress?: number;
  strategyHash?: string | null;
  datasetVersionIds?: unknown;
  engineVersion?: string;
  parameters: unknown;
  metrics: unknown;
  errorMessage: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdAt?: Date;
  artifacts?: Array<{
    id: string;
    quantRunLegId?: string | null;
    scopeKey?: string;
    kind: string;
    checksum: string;
    payload: unknown;
    rowCount: number;
    schemaVersion: number;
  }>;
}): QuantRunResponse {
  const timeframe = run.timeframe === "1h" ? "1h" : "1d";
  const datasetVersionIds = Array.isArray(run.datasetVersionIds)
    ? run.datasetVersionIds.filter((value): value is string => typeof value === "string")
    : [];
  return {
    id: run.id,
    strategyName: run.strategyName,
    strategyCode: run.strategyVersion?.code ?? "legacy",
    strategyVersion: run.strategyVersion?.version ?? "0.0.0",
    status: assertQuantRunStatus(run.status),
    timeframe,
    progress: run.progress ?? (run.status === "succeeded" || run.status === "failed" ? 100 : 0),
    strategyHash: run.strategyHash ?? null,
    datasetVersionIds,
    engineVersion: run.engineVersion ?? "legacy-v1",
    parameters: objectJson(run.parameters),
    metrics: run.metrics === null ? null : objectJson(run.metrics),
    errorMessage: run.errorMessage,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt?.toISOString() ?? new Date(0).toISOString(),
    legs: [],
    artifacts: (run.artifacts ?? []).map((artifact) => ({
      id: artifact.id,
      quantRunLegId: artifact.quantRunLegId ?? null,
      scopeKey: artifact.scopeKey ?? "aggregate",
      kind:
        artifact.kind === "equity" || artifact.kind === "drawdown" || artifact.kind === "trades"
          ? artifact.kind
          : "manifest",
      checksum: artifact.checksum,
      payload: artifact.payload,
      rowCount: artifact.rowCount,
      schemaVersion: artifact.schemaVersion,
    })),
  };
}

function insightToInvestorInput(insight: {
  id: string;
  source: string;
  assetId: string | null;
  sentiment: string;
  title: string;
  summary: string;
  confidence: number | null;
  catalyst: string | null;
  risk: string | null;
  publishedAt: Date;
  asset?: { symbol: string } | null;
}): InvestorInsightInput {
  return {
    id: insight.id,
    source: insight.source,
    asset: insight.asset?.symbol ?? "Asset",
    sentiment: assertInsightSentiment(insight.sentiment),
    title: insight.title,
    summary: insight.summary,
    publishedAt: insight.publishedAt.toISOString(),
    confidence: insight.confidence ?? 50,
    catalyst: insight.catalyst,
    risk: insight.risk,
  };
}

function evidenceToInput(evidence: {
  id: string;
  insightId: string | null;
  sourceType: string;
  sourceName: string;
  url: string | null;
  title: string;
  excerpt: string;
  engagement: number;
  observedAt: Date;
}): InsightEvidenceInput {
  return {
    id: evidence.id,
    insightId: evidence.insightId,
    sourceType: evidence.sourceType,
    sourceName: evidence.sourceName,
    url: evidence.url,
    title: evidence.title,
    excerpt: evidence.excerpt,
    engagement: evidence.engagement,
    observedAt: evidence.observedAt.toISOString(),
  };
}

function thesisToInput(
  thesis: {
    id: string;
    stance: string;
    conviction: number;
    thesis: string;
    bullCase: string;
    bearCase: string;
    actionItems: unknown;
    updatedAt: Date;
  },
  symbol: string,
): InvestmentThesisInput {
  return {
    id: thesis.id,
    symbol,
    stance: assertThesisStance(thesis.stance),
    conviction: thesis.conviction,
    thesis: thesis.thesis,
    bullCase: thesis.bullCase,
    bearCase: thesis.bearCase,
    actionItems: stringArrayJson(thesis.actionItems),
    updatedAt: thesis.updatedAt.toISOString(),
  };
}

function forecastToInput(forecast: {
  horizon: string;
  targetPrice: unknown;
  lowerBound: unknown;
  upperBound: unknown;
  confidence: number;
  model: string;
  generatedAt: Date;
}): ForecastPointInput {
  return {
    horizon: forecast.horizon,
    targetPrice: numberFromDecimal(forecast.targetPrice),
    lowerBound: numberFromDecimal(forecast.lowerBound),
    upperBound: numberFromDecimal(forecast.upperBound),
    confidence: forecast.confidence,
    model: forecast.model,
    generatedAt: forecast.generatedAt.toISOString(),
  };
}

function researchRunToResponse(run: {
  id: string;
  source: string;
  kind: string;
  status: string;
  summary: string | null;
  parameters: unknown;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  asset: { symbol: string } | null;
}): ResearchRunResponse {
  return {
    id: run.id,
    source: run.source,
    kind: run.kind,
    symbol: run.asset?.symbol ?? null,
    status: assertQuantRunStatus(run.status),
    summary: run.summary,
    parameters: objectJson(run.parameters),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

export function normalizePortfolioTimeframe(value: string | null): PortfolioTimeframe {
  if (value === "1W" || value === "YTD" || value === "1Y") return value;
  return "1M";
}
