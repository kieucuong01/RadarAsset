import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { buildAssetIntelligence } from "./investor-intelligence";
import { buildTickerResponse } from "./market";
import {
  buildPortfolioResponse,
  buildTradeAwarePerformance,
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
  MarketTickerResponse,
  PortfolioHistoricalBar,
  PortfolioLedgerAsset,
  PortfolioLedgerTransaction,
  PortfolioResponse,
  QuantRunResponse,
  QuantRunStatus,
  ResearchRunResponse,
  TransactionType,
} from "./types";

export const DEMO_USER_EMAIL = "demo@radarasset.local";

const TIMEFRAME_LIMITS = {
  "1W": 7,
  "1M": 30,
  YTD: 90,
  "1Y": 252,
} as const;

type PortfolioTimeframe = keyof typeof TIMEFRAME_LIMITS;

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
  return value === "sell" ? "sell" : "buy";
}

function assertQuantRunStatus(value: string): QuantRunStatus {
  if (value === "running" || value === "succeeded" || value === "failed") return value;
  return "queued";
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

export async function getDemoUser() {
  const prisma = getPrisma();
  const user = await prisma.appUser.findUnique({ where: { email: DEMO_USER_EMAIL } });
  if (!user) {
    throw new Error("Demo user not found. Run npm run db:seed first.");
  }
  return user;
}

export async function loadPortfolioResponse(
  timeframe: PortfolioTimeframe = "1M",
): Promise<PortfolioResponse> {
  const prisma = getPrisma();
  const portfolio = await prisma.portfolio.findFirst({
    where: { user: { email: DEMO_USER_EMAIL } },
    include: {
      transactions: {
        include: { asset: true },
        orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!portfolio) {
    throw new Error("Demo portfolio not found. Run npm run db:seed first.");
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
  const latestBars = latestBarsByAssetId(bars);

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
      latestPrice:
        latestBars.get(assetId)?.close ?? latestTransactionPrices.get(assetId) ?? 0,
    }),
  );
  const ledger = replayPortfolioLedger({ assets: ledgerAssets, transactions });

  const historicalBars: PortfolioHistoricalBar[] = bars.map((bar) => ({
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

export async function createPortfolioTransaction(input: {
  symbol: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fee?: number;
  executedAt?: string;
  note?: string | null;
}) {
  const prisma = getPrisma();
  const symbol = input.symbol.trim().toUpperCase();
  const portfolio = await prisma.portfolio.findFirst({
    where: { user: { email: DEMO_USER_EMAIL } },
    select: { id: true },
  });
  if (!portfolio) throw new Error("Demo portfolio not found. Run npm run db:seed first.");

  const asset = await prisma.asset.findUnique({ where: { symbol } });
  if (!asset) throw new Error(`Asset ${symbol} not found.`);

  await prisma.$transaction(async (tx) => {
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

  return loadPortfolioResponse();
}

export async function loadPortfolioPerformance(timeframe: PortfolioTimeframe) {
  const portfolio = await loadPortfolioResponse(timeframe);
  return portfolio.performance;
}

export async function loadAssets() {
  const prisma = getPrisma();
  return prisma.asset.findMany({
    orderBy: [{ assetClass: "asc" }, { symbol: "asc" }],
    select: {
      id: true,
      symbol: true,
      name: true,
      assetClass: true,
      currency: true,
      provider: true,
      providerSymbol: true,
    },
  });
}

export async function loadTickerResponse(symbols?: string[]): Promise<MarketTickerResponse[]> {
  const prisma = getPrisma();
  const bars = await prisma.marketBar.findMany({
    where: {
      timeframe: "1d",
      asset: symbols?.length ? { symbol: { in: symbols } } : undefined,
    },
    include: { asset: true },
    orderBy: [{ assetId: "asc" }, { ts: "asc" }],
  });

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

  return {
    asset,
    timeframe,
    bars: bars.map((bar) => ({
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
      where: { assetId: asset.id },
      orderBy: { publishedAt: "desc" },
      take: 12,
    }),
    prisma.evidenceItem.findMany({
      where: { assetId: asset.id },
      orderBy: { observedAt: "desc" },
      take: 20,
    }),
    prisma.investmentThesis.findFirst({
      where: { assetId: asset.id },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.forecastPoint.findMany({
      where: { assetId: asset.id },
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

export async function loadWatchlist() {
  const prisma = getPrisma();
  const user = await getDemoUser();
  const [items, tickers, insights] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId: user.id },
      include: { asset: true },
      orderBy: { createdAt: "asc" },
    }),
    loadTickerResponse(),
    prisma.aiInsight.findMany({
      include: { asset: true },
      orderBy: { publishedAt: "desc" },
    }),
  ]);

  const tickerBySymbol = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
  const sentimentBySymbol = new Map<string, string>();
  for (const insight of insights) {
    if (insight.asset?.symbol && !sentimentBySymbol.has(insight.asset.symbol)) {
      sentimentBySymbol.set(insight.asset.symbol, insight.sentiment);
    }
  }

  return items.map((item) => {
    const ticker = tickerBySymbol.get(item.asset.symbol);
    return {
      id: item.id,
      sym: item.asset.symbol,
      name: item.asset.name,
      price: ticker?.price ?? 0,
      chg: ticker?.changePercent ?? 0,
      alert: item.alert === null ? 0 : numberFromDecimal(item.alert),
      sentiment: sentimentBySymbol.get(item.asset.symbol) ?? "neutral",
    };
  });
}

export async function loadResearchRuns(): Promise<ResearchRunResponse[]> {
  const prisma = getPrisma();
  const runs = await prisma.researchRun.findMany({
    include: { asset: { select: { symbol: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return runs.map(researchRunToResponse);
}

export async function importResearchRun(input: {
  source: string;
  kind: string;
  symbol?: string | null;
  status?: QuantRunStatus;
  summary?: string | null;
  parameters?: Record<string, unknown>;
  startedAt?: string | null;
  finishedAt?: string | null;
  insights?: Array<{
    source?: string;
    title: string;
    summary: string;
    sentiment: InvestorInsightInput["sentiment"];
    confidence?: number;
    catalyst?: string | null;
    risk?: string | null;
    publishedAt?: string;
  }>;
  evidence?: Array<{
    sourceType: string;
    sourceName: string;
    url?: string | null;
    title: string;
    excerpt: string;
    engagement?: number;
    observedAt?: string;
  }>;
  thesis?: {
    stance: InvestmentThesisInput["stance"];
    conviction: number;
    thesis: string;
    bullCase: string;
    bearCase: string;
    actionItems: string[];
  } | null;
  forecasts?: Array<{
    horizon: string;
    targetPrice: number;
    lowerBound: number;
    upperBound: number;
    confidence: number;
    model: string;
    generatedAt?: string;
  }>;
  providerRuns?: Array<{
    provider: string;
    status: QuantRunStatus;
    recordsFetched?: number;
    errorMessage?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }>;
}): Promise<ResearchRunResponse> {
  const prisma = getPrisma();
  const user = await getDemoUser();
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
        userId: user.id,
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

export async function upsertWatchlistItem(input: { symbol: string; alert?: number | null }) {
  const prisma = getPrisma();
  const user = await getDemoUser();
  const symbol = input.symbol.trim().toUpperCase();
  const asset = await prisma.asset.findUnique({ where: { symbol }, select: { id: true } });
  if (!asset) throw new Error(`Asset ${symbol} not found.`);

  await prisma.watchlistItem.upsert({
    where: { userId_assetId: { userId: user.id, assetId: asset.id } },
    create: {
      userId: user.id,
      assetId: asset.id,
      alert: input.alert ?? null,
    },
    update: {
      alert: input.alert ?? null,
    },
  });

  return loadWatchlist();
}

export async function createQuantRun(input: {
  strategyName: string;
  parameters?: Record<string, unknown>;
}) {
  const prisma = getPrisma();
  const user = await getDemoUser();
  const run = await prisma.quantRun.create({
    data: {
      userId: user.id,
      strategyName: input.strategyName,
      status: "queued",
      parameters: (input.parameters ?? {}) as Prisma.InputJsonValue,
    },
  });
  return quantRunToResponse(run);
}

export async function listQuantRuns() {
  const prisma = getPrisma();
  const runs = await prisma.quantRun.findMany({
    where: { user: { email: DEMO_USER_EMAIL } },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  return runs.map(quantRunToResponse);
}

export async function getQuantRun(id: string) {
  const prisma = getPrisma();
  const run = await prisma.quantRun.findUnique({ where: { id } });
  if (!run) throw new Error("Quant run not found.");
  return quantRunToResponse(run);
}

function quantRunToResponse(run: {
  id: string;
  strategyName: string;
  status: string;
  parameters: unknown;
  metrics: unknown;
  errorMessage: string | null;
}): QuantRunResponse {
  return {
    id: run.id,
    strategyName: run.strategyName,
    status: assertQuantRunStatus(run.status),
    parameters: objectJson(run.parameters),
    metrics: run.metrics === null ? null : objectJson(run.metrics),
    errorMessage: run.errorMessage,
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
