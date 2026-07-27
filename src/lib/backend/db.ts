import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { buildTickerResponse } from "./market";
import { applyPortfolioTransaction, buildPortfolioResponse } from "./portfolio";
import type {
  AssetClass,
  MarketBarInput,
  MarketTickerResponse,
  PortfolioPerformancePoint,
  PortfolioPositionInput,
  PortfolioResponse,
  PortfolioTransactionInput,
  QuantRunResponse,
  QuantRunStatus,
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

function objectJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function buildPerformance(
  positions: PortfolioPositionInput[],
  bars: {
    assetId: string;
    ts: Date;
    close: unknown;
  }[],
  benchmarkAssetId: string | null,
  timeframe: PortfolioTimeframe,
): PortfolioPerformancePoint[] {
  const limit = TIMEFRAME_LIMITS[timeframe];
  const positionIds = new Set(positions.map((position) => position.assetId));
  const rowsByDate = new Map<string, Map<string, number>>();

  for (const bar of bars) {
    const key = bar.ts.toISOString().slice(0, 10);
    const row = rowsByDate.get(key) ?? new Map<string, number>();
    row.set(bar.assetId, numberFromDecimal(bar.close));
    rowsByDate.set(key, row);
  }

  const rows = Array.from(rowsByDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-limit)
    .map(([dateKey, prices]) => {
      const portfolioValue = positions.reduce((sum, position) => {
        const price = prices.get(position.assetId) ?? position.latestPrice;
        return sum + price * position.quantity;
      }, 0);
      const benchmark = benchmarkAssetId ? (prices.get(benchmarkAssetId) ?? null) : null;
      return { dateKey, portfolioValue, benchmark };
    })
    .filter((row) => row.portfolioValue > 0);

  const firstPortfolio = rows[0]?.portfolioValue ?? 1;
  const firstBenchmark = rows.find((row) => row.benchmark !== null)?.benchmark ?? firstPortfolio;

  return rows.map((row) => ({
    label: formatDateLabel(new Date(`${row.dateKey}T00:00:00.000Z`)),
    Portfolio: Number(((row.portfolioValue / firstPortfolio) * 100).toFixed(2)),
    Benchmark: Number((((row.benchmark ?? firstBenchmark) / firstBenchmark) * 100).toFixed(2)),
  }));
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
      positions: {
        include: { asset: true },
        orderBy: { updatedAt: "desc" },
      },
      transactions: {
        include: { asset: true },
        orderBy: { executedAt: "desc" },
        take: 25,
      },
    },
  });

  if (!portfolio) {
    throw new Error("Demo portfolio not found. Run npm run db:seed first.");
  }

  const assetIds = portfolio.positions.map((position) => position.assetId);
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

  const positions: PortfolioPositionInput[] = portfolio.positions.map((position) => {
    const latest = latestBars.get(position.assetId);
    return {
      assetId: position.assetId,
      symbol: position.asset.symbol,
      name: position.asset.name,
      assetClass: assertAssetClass(position.asset.assetClass),
      quantity: numberFromDecimal(position.quantity),
      averageCost: numberFromDecimal(position.averageCost),
      latestPrice: latest?.close ?? numberFromDecimal(position.averageCost),
    };
  });

  const transactions: PortfolioTransactionInput[] = portfolio.transactions.map((transaction) => ({
    id: transaction.id,
    type: assertTransactionType(transaction.type),
    assetId: transaction.assetId,
    symbol: transaction.asset.symbol,
    quantity: numberFromDecimal(transaction.quantity),
    price: numberFromDecimal(transaction.price),
    fee: numberFromDecimal(transaction.fee),
    executedAt: transaction.executedAt.toISOString(),
    note: transaction.note,
  }));

  const performance = buildPerformance(positions, bars, benchmark?.id ?? null, timeframe);
  const latestAsOf = Array.from(latestBars.values()).sort(
    (a, b) => b.ts.getTime() - a.ts.getTime(),
  )[0];
  return buildPortfolioResponse({
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    baseCurrency: portfolio.baseCurrency,
    positions,
    transactions,
    performance,
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

  const current = await prisma.portfolioPosition.findUnique({
    where: { portfolioId_assetId: { portfolioId: portfolio.id, assetId: asset.id } },
    include: { asset: true },
  });

  const next = applyPortfolioTransaction(
    current
      ? {
          assetId: current.assetId,
          symbol: current.asset.symbol,
          name: current.asset.name,
          assetClass: assertAssetClass(current.asset.assetClass),
          quantity: numberFromDecimal(current.quantity),
          averageCost: numberFromDecimal(current.averageCost),
          latestPrice: input.price,
        }
      : null,
    {
      type: input.type,
      assetId: asset.id,
      symbol: asset.symbol,
      quantity: input.quantity,
      price: input.price,
      fee: input.fee ?? 0,
      executedAt: input.executedAt ?? new Date().toISOString(),
      note: input.note,
    },
  );

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

    if (next.quantity <= 0) {
      await tx.portfolioPosition.deleteMany({
        where: { portfolioId: portfolio.id, assetId: asset.id },
      });
      return;
    }

    await tx.portfolioPosition.upsert({
      where: { portfolioId_assetId: { portfolioId: portfolio.id, assetId: asset.id } },
      create: {
        portfolioId: portfolio.id,
        assetId: asset.id,
        quantity: next.quantity,
        averageCost: next.averageCost,
      },
      update: {
        quantity: next.quantity,
        averageCost: next.averageCost,
      },
    });
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
    include: { asset: true },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  return insights.map((insight) => ({
    id: insight.id,
    source: insight.source,
    asset: insight.asset?.symbol ?? "Macro",
    sentiment: insight.sentiment,
    title: insight.title,
    summary: insight.summary,
    publishedAt: insight.publishedAt.toISOString(),
    ago: relativeAge(insight.publishedAt),
  }));
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

export function normalizePortfolioTimeframe(value: string | null): PortfolioTimeframe {
  if (value === "1W" || value === "YTD" || value === "1Y") return value;
  return "1M";
}
