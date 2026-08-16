import type { Prisma } from "@prisma/client";
import type { TenantContext } from "@/lib/auth/tenant-context";
import { getPrisma } from "@/lib/db/prisma";

import { numberFromDecimal, objectJson, stringArrayJson } from "./db-mappers";
import { requestMarketIngestion } from "./ingestion-requests";
import { buildAssetIntelligence } from "./investor-intelligence";
import { loadTickerResponse } from "./market-repository";
import { resolveProviderInstrument } from "./provider-catalog";
import type {
  AssetIntelligenceResponse,
  ForecastPointInput,
  InsightEvidenceInput,
  InvestmentThesisInput,
  InvestorInsightInput,
  QuantRunStatus,
  ResearchRunImportInput,
  ResearchRunResponse,
  WatchlistMutationInput,
} from "./types";
import type { WorkerImportContext } from "./worker-context";

const ELIGIBLE_DATASET_QUALITY = ["passed", "warning"] as const;

function assertQuantRunStatus(value: string): QuantRunStatus {
  if (
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancel_requested" ||
    value === "cancelled" ||
    value === "timed_out"
  ) {
    return value;
  }
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
    where: { sourceCode: { not: "seed" }, eventAt: { not: null } },
    orderBy: { eventAt: "asc" },
    take: 50,
  });

  return events.flatMap((event) => {
    if (!event.eventAt) return [];
    return [
      {
        id: event.id,
        country: event.country,
        event: event.event,
        impact: event.impact === "medium" ? "mid" : event.impact,
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
      },
    ];
  });
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
      currency: item.asset.currency,
      hasMarketQuote: Boolean(ticker),
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
