import { getPrisma } from "@/lib/db/prisma";
import { calculateFreshness } from "@/lib/market-data/health";

import { numberFromDecimal, objectJson } from "./db-mappers";
import { buildTickerResponse } from "./market";
import type {
  AssetClass,
  MarketBarInput,
  MarketDataHealthItem,
  MarketDataMarket,
  MarketDataTimeframe,
  MarketIngestionStatus,
  MarketTickerResponse,
} from "./types";

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

export function assertAssetClass(value: string): AssetClass {
  const known = ["crypto", "equity", "etf", "index", "fx", "commodity", "cash"];
  return known.includes(value) ? (value as AssetClass) : "equity";
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

export type ActiveDatasetBarRow = {
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

export async function loadActiveMarketBarsForAssets(
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

export function preferActiveDatasetBars<
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
  return [...datasetBars, ...marketBars.filter((bar) => !datasetAssetIds.has(bar.assetId))].sort(
    (left, right) => {
      const assetOrder = left.assetId.localeCompare(right.assetId);
      if (assetOrder !== 0) return assetOrder;
      return left.ts.getTime() - right.ts.getTime();
    },
  );
}

export function latestBarsByAssetId(
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

function marketForSymbol(symbol: (typeof MARKET_DATA_SYMBOLS)[number]): MarketDataMarket {
  if (symbol === "FPT") return "vn_equity";
  if (symbol === "BTC") return "crypto_spot";
  return "metal_spot";
}

export async function loadAssets() {
  const prisma = getPrisma();
  const assets = await prisma.asset.findMany({
    where: {
      market: { in: ["vn_equity", "crypto_spot", "metal_spot"] },
      NOT: [
        {
          market: { not: "vn_equity" },
          assetClass: { in: ["equity", "etf", "stock", "index"] },
        },
        { symbol: "XMR" },
      ],
    },
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
  const datasetBars = await loadActiveMarketBarsForAssets(prisma, {
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
  const datasetBars = await loadActiveMarketBarsForAssets(prisma, {
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
