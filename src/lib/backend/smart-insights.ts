import { Prisma } from "@prisma/client";

import type { TenantContext } from "@/lib/auth/tenant-context";
import { derivePortfolioOpinionChanges } from "@/lib/asset-opinion-changes";
import { getPrisma } from "@/lib/db/prisma";

import type {
  AssetOpinionEvidenceReadModel,
  AssetOpinionPerformanceReadModel,
  AssetOpinionReadModel,
  BriefingItemReadModel,
  BriefingReadModel,
  CalendarEventReadModel,
  EvidenceDetailReadModel,
  FreshnessState,
  InsightMarket,
  InsightPreferences,
  InsightPreferencesResponse,
  MarketRegimeReadModel,
  MetricReadModel,
  RelevanceComponents,
} from "./smart-insights-types";

const MARKETS = new Set<InsightMarket>(["crypto", "macro", "gold"]);
const IMPACTS = new Set(["high", "medium", "low"]);
const HORIZONS = new Set(["DAYS_1_7", "WEEKS_1_4", "MONTHS_1_3"]);
const RISKS = new Set(["conservative", "moderate", "aggressive"]);
const ASSET_STANCES = new Set([
  "POSITIVE",
  "CONSTRUCTIVE",
  "NEUTRAL",
  "CAUTIOUS",
  "NEGATIVE",
  "INSUFFICIENT_DATA",
]);
const ASSET_ACTIONS = new Set([
  "HOLD",
  "REVIEW_INCREASE",
  "REVIEW_REDUCE_RISK",
  "WAIT_CONFIRMATION",
  "NO_ACTION_INSUFFICIENT_DATA",
]);
const ASSET = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;
const CURRENCY = /^[A-Z]{3}$/;

export const DEFAULT_INSIGHT_PREFERENCES: InsightPreferences = {
  markets: ["crypto", "macro", "gold"],
  assets: [],
  locale: "vi",
  baseCurrency: "USD",
  investmentHorizon: "WEEKS_1_4",
  riskTolerance: "moderate",
  alertPreferences: { highImpact: true },
};

export class SmartInsightsInputError extends Error {}

function decimal(value: unknown): string {
  if (value && typeof value === "object" && "toString" in value) return value.toString();
  return String(value ?? "0");
}

function strings(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function object(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export type BriefingDateCatalog = { today: string; dates: string[] };

export function smartInsightsToday(now = new Date()): string {
  const timeZone = process.env.SMART_INSIGHTS_TIMEZONE?.trim() || "Asia/Bangkok";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function loadBriefingDateCatalog(
  context: TenantContext,
  now = new Date(),
): Promise<BriefingDateCatalog> {
  const rows = await getPrisma().dailyBriefing.groupBy({
    by: ["effectiveDate"],
    where: { organizationId: context.organizationId, userId: context.userId },
    orderBy: { effectiveDate: "desc" },
    take: 90,
  });
  const dates = [...new Set(rows.map((row) => dateOnly(row.effectiveDate)))].slice(0, 90);
  return { today: smartInsightsToday(now), dates };
}

export function parseInsightWindow(url: URL): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(
    url.searchParams.get("from") ?? new Date(now.getTime() - 7 * 86_400_000).toISOString(),
  );
  const to = new Date(url.searchParams.get("to") ?? now.toISOString());
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw new SmartInsightsInputError("Invalid date window.");
  }
  if (to.getTime() - from.getTime() > 31 * 86_400_000) {
    throw new SmartInsightsInputError("Date window must not exceed 31 days.");
  }
  return { from, to };
}

function freshness(observedAt: Date, slaMinutes: number, qualityStatus = "passed"): FreshnessState {
  if (qualityStatus === "conflicting") return "conflicting";
  if (qualityStatus === "quarantined") return "unavailable";
  return Date.now() - observedAt.getTime() <= slaMinutes * 60_000 ? "fresh" : "stale";
}

function relevance(value: Prisma.JsonValue): RelevanceComponents {
  const row = object(value);
  return {
    exposure: String(row.exposure ?? "0"),
    magnitude: String(row.magnitude ?? "0"),
    proximity: String(row.proximity ?? "0"),
    interest: String(row.interest ?? "0"),
    dataConfidence: String(row.data_confidence ?? row.dataConfidence ?? "0"),
  };
}

function briefingItem(row: {
  id: string;
  signalSnapshotId: string;
  relevanceScore: unknown;
  relevanceComponents: Prisma.JsonValue;
  supportingEvidenceIds: Prisma.JsonValue;
  contradictingEvidenceIds: Prisma.JsonValue;
  affectedAssets: Prisma.JsonValue;
  timeHorizon: string;
  riskScenarios: Prisma.JsonValue;
  suggestedCheckTemplate: string;
  explanationStatus: string;
  confidence: unknown;
  signalSnapshot: {
    market: string;
    signalType: string;
    score: unknown;
    label: string;
    asset: { symbol: string } | null;
  };
  aiInsight: { title: string; summary: string; catalyst: string | null } | null;
}): BriefingItemReadModel {
  return {
    id: row.id,
    signalId: row.signalSnapshotId,
    market: row.signalSnapshot.market as InsightMarket,
    asset: row.signalSnapshot.asset?.symbol ?? null,
    signalType: row.signalSnapshot.signalType,
    regimeLabel: row.signalSnapshot.label,
    score: row.signalSnapshot.score == null ? null : decimal(row.signalSnapshot.score),
    headline: row.aiInsight?.title ?? null,
    whatChanged: row.aiInsight?.summary ?? null,
    whyItMatters: row.aiInsight?.catalyst ?? null,
    explanationStatus: row.explanationStatus as BriefingItemReadModel["explanationStatus"],
    suggestedCheckTemplate: row.suggestedCheckTemplate,
    confidence: decimal(row.confidence),
    relevanceScore: decimal(row.relevanceScore),
    relevanceComponents: relevance(row.relevanceComponents),
    supportingEvidenceIds: strings(row.supportingEvidenceIds),
    contradictingEvidenceIds: strings(row.contradictingEvidenceIds),
    affectedAssets: strings(row.affectedAssets),
    timeHorizon: row.timeHorizon,
    riskScenarios: strings(row.riskScenarios),
  };
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function assetFreshness(value: unknown): FreshnessState {
  return value === "fresh" ||
    value === "stale" ||
    value === "conflicting" ||
    value === "partial" ||
    value === "unavailable"
    ? value
    : "unavailable";
}

function assetOpinionFallback(raw: unknown): AssetOpinionReadModel {
  const row =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const symbol = typeof row.symbol === "string" && row.symbol ? row.symbol : "UNKNOWN";
  return {
    symbol,
    assetName: typeof row.assetName === "string" && row.assetName ? row.assetName : symbol,
    stance: "INSUFFICIENT_DATA",
    quantScore: null,
    confidence: "0",
    horizon: "WEEKS_1_4",
    portfolioWeightPct: "0",
    unrealizedReturn: null,
    riskTolerance: "moderate",
    personalizedAction: "NO_ACTION_INSUFFICIENT_DATA",
    pillars: [],
    thesis: null,
    bullCase: null,
    baseCase: null,
    bearCase: null,
    invalidationConditions: [],
    quantInvalidationConditions: [],
    formula: "asset_score = Σ(pillar_score × pillar_weight) ÷ data_coverage",
    totalContribution: "0",
    decisionInputs: [],
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    evidence: [],
    dataCoverage: "0",
    freshness: "unavailable",
    explanationStatus: "unavailable",
    failedGates: ["STORED_CONTRACT_INVALID"],
    performance: { status: "accumulating", horizons: [] },
  };
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value) throw new Error(`Invalid ${key}.`);
  return value;
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function decimalString(value: unknown, key: string): string {
  const parsed =
    typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  if (
    !Number.isFinite(parsed) ||
    (typeof value === "string" && !/^-?(?:\d+|\d*\.\d+)$/.test(value))
  ) {
    throw new Error(`Invalid ${key}.`);
  }
  return String(value);
}

function nullableDecimalString(value: unknown, key: string): string | null {
  return value == null ? null : decimalString(value, key);
}

function enumString(value: unknown, values: ReadonlySet<string>, key: string): string {
  if (typeof value !== "string" || !values.has(value)) throw new Error(`Invalid ${key}.`);
  return value;
}

function timestampString(value: unknown, key: string): string {
  const timestamp = requiredString({ [key]: value }, key);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`Invalid ${key}.`);
  }
  return timestamp;
}

function urlString(value: unknown, key: string): string {
  const url = requiredString({ [key]: value }, key);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`Invalid ${key}.`);
  }
  return url;
}

function storedAssetOpinion(raw: unknown): AssetOpinionReadModel {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid asset opinion.");
  const row = raw as Record<string, unknown>;
  if (
    !Array.isArray(row.pillars) ||
    !Array.isArray(row.evidence) ||
    !Array.isArray(row.decisionInputs) ||
    !Array.isArray(row.supportingEvidenceIds) ||
    !Array.isArray(row.contradictingEvidenceIds) ||
    !Array.isArray(row.quantInvalidationConditions)
  ) {
    throw new Error("Invalid asset opinion collections.");
  }
  const pillars = row.pillars.map((rawPillar) => {
    if (!rawPillar || typeof rawPillar !== "object" || Array.isArray(rawPillar)) {
      throw new Error("Invalid pillar.");
    }
    const pillar = rawPillar as Record<string, unknown>;
    if (!Array.isArray(pillar.factIds) || !Array.isArray(pillar.series)) {
      throw new Error("Invalid pillar fields.");
    }
    return {
      code: requiredString(pillar, "code"),
      score: nullableDecimalString(pillar.score, "pillar.score"),
      weight: decimalString(pillar.weight, "pillar.weight"),
      confidence: decimalString(pillar.confidence, "pillar.confidence"),
      availableInputWeight: decimalString(
        pillar.availableInputWeight,
        "pillar.availableInputWeight",
      ),
      contribution: decimalString(pillar.contribution, "pillar.contribution"),
      factIds: pillar.factIds.filter((value): value is string => typeof value === "string"),
      series: pillar.series.map((rawPoint) => {
        if (!rawPoint || typeof rawPoint !== "object" || Array.isArray(rawPoint)) {
          throw new Error("Invalid series point.");
        }
        const point = rawPoint as Record<string, unknown>;
        const value = finiteNumber(point.value);
        if (value == null) throw new Error("Invalid series value.");
        return { ts: timestampString(point.ts, "ts"), value };
      }),
    };
  });
  const evidence = row.evidence.map((rawEvidence): AssetOpinionEvidenceReadModel => {
    if (!rawEvidence || typeof rawEvidence !== "object" || Array.isArray(rawEvidence)) {
      throw new Error("Invalid evidence.");
    }
    const evidence = rawEvidence as Record<string, unknown>;
    const impact = evidence.impact;
    if (impact !== "supporting" && impact !== "contradicting" && impact !== "neutral") {
      throw new Error("Invalid evidence impact.");
    }
    if (evidence.usedInDecision !== true) {
      throw new Error("Invalid usedInDecision.");
    }
    return {
      id: requiredString(evidence, "id"),
      metricCode: requiredString(evidence, "metricCode"),
      displayValue: String(evidence.displayValue ?? ""),
      delta: nullableDecimalString(evidence.delta, "evidence.delta"),
      percentile: nullableDecimalString(evidence.percentile, "evidence.percentile"),
      impact,
      sourceCode: requiredString(evidence, "sourceCode"),
      sourceUrl: urlString(evidence.sourceUrl, "sourceUrl"),
      effectiveAt: timestampString(evidence.effectiveAt, "effectiveAt"),
      observedAt: timestampString(evidence.observedAt, "observedAt"),
      freshness: assetFreshness(evidence.freshness),
      usedInDecision: true,
    };
  });
  const decisionInputs = row.decisionInputs.map((rawInput) => {
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      throw new Error("Invalid decision input.");
    }
    const input = rawInput as Record<string, unknown>;
    return {
      evidenceId: requiredString(input, "evidenceId"),
      metricCode: requiredString(input, "metricCode"),
      pillarCode: requiredString(input, "pillarCode"),
      rawValue: decimalString(input.rawValue, "input.rawValue"),
      unit: requiredString(input, "unit"),
      normalizedScore: decimalString(input.normalizedScore, "input.normalizedScore"),
      inputWeight: decimalString(input.inputWeight, "input.inputWeight"),
      weightedScore: decimalString(input.weightedScore, "input.weightedScore"),
      pillarWeight: decimalString(input.pillarWeight, "input.pillarWeight"),
      contribution: decimalString(input.contribution, "input.contribution"),
      normalizationMethod: requiredString(input, "normalizationMethod"),
      percentile: nullableDecimalString(input.percentile, "input.percentile"),
      lookback: nullableString(input.lookback),
    };
  });
  const explanationStatus = row.explanationStatus;
  if (
    explanationStatus !== "accepted" &&
    explanationStatus !== "quant_only" &&
    explanationStatus !== "insufficient_data" &&
    explanationStatus !== "unavailable"
  ) {
    throw new Error("Invalid explanation status.");
  }
  const riskTolerance = enumString(row.riskTolerance, RISKS, "riskTolerance") as
    | "conservative"
    | "moderate"
    | "aggressive";
  const parsed: AssetOpinionReadModel = {
    symbol: requiredString(row, "symbol"),
    assetName: requiredString(row, "assetName"),
    stance: enumString(row.stance, ASSET_STANCES, "stance"),
    quantScore: nullableDecimalString(row.quantScore, "quantScore"),
    confidence: decimalString(row.confidence, "confidence"),
    horizon: enumString(row.horizon, HORIZONS, "horizon"),
    portfolioWeightPct: decimalString(row.portfolioWeightPct, "portfolioWeightPct"),
    unrealizedReturn: nullableDecimalString(row.unrealizedReturn, "unrealizedReturn"),
    riskTolerance,
    personalizedAction: enumString(row.personalizedAction, ASSET_ACTIONS, "personalizedAction"),
    pillars,
    thesis: nullableString(row.thesis),
    bullCase: nullableString(row.bullCase),
    baseCase: nullableString(row.baseCase),
    bearCase: nullableString(row.bearCase),
    invalidationConditions: Array.isArray(row.invalidationConditions)
      ? row.invalidationConditions.filter((value): value is string => typeof value === "string")
      : [],
    quantInvalidationConditions: row.quantInvalidationConditions.filter(
      (value): value is string => typeof value === "string",
    ),
    formula: requiredString(row, "formula"),
    totalContribution: decimalString(row.totalContribution, "totalContribution"),
    decisionInputs,
    supportingEvidenceIds: row.supportingEvidenceIds.filter(
      (value): value is string => typeof value === "string",
    ),
    contradictingEvidenceIds: row.contradictingEvidenceIds.filter(
      (value): value is string => typeof value === "string",
    ),
    evidence,
    dataCoverage: decimalString(row.dataCoverage, "dataCoverage"),
    freshness: assetFreshness(row.freshness),
    explanationStatus,
    failedGates: Array.isArray(row.failedGates)
      ? row.failedGates.filter((value): value is string => typeof value === "string")
      : [],
  };
  const evidenceIds = new Set(parsed.evidence.map((item) => item.id));
  if (
    parsed.decisionInputs.length > 12 ||
    parsed.evidence.length > 12 ||
    parsed.supportingEvidenceIds.length > 5 ||
    parsed.contradictingEvidenceIds.length > 3 ||
    parsed.decisionInputs.some((item) => !evidenceIds.has(item.evidenceId)) ||
    parsed.supportingEvidenceIds.some((id) => !evidenceIds.has(id)) ||
    parsed.contradictingEvidenceIds.some((id) => !evidenceIds.has(id))
  ) {
    throw new Error("Invalid bounded decision evidence.");
  }
  if (
    parsed.explanationStatus === "accepted" &&
    (parsed.freshness !== "fresh" ||
      !parsed.thesis ||
      !parsed.bullCase ||
      !parsed.baseCase ||
      !parsed.bearCase ||
      parsed.invalidationConditions.length === 0 ||
      parsed.evidence.length === 0)
  ) {
    throw new Error("Invalid accepted opinion state.");
  }
  if (
    (parsed.explanationStatus === "insufficient_data" ||
      parsed.explanationStatus === "unavailable") &&
    parsed.personalizedAction !== "NO_ACTION_INSUFFICIENT_DATA"
  ) {
    throw new Error("Invalid insufficient-data action.");
  }
  if (
    parsed.explanationStatus !== "accepted" &&
    (parsed.thesis !== null ||
      parsed.bullCase !== null ||
      parsed.baseCase !== null ||
      parsed.bearCase !== null ||
      parsed.invalidationConditions.length > 0)
  ) {
    throw new Error("Non-accepted opinions cannot contain AI prose.");
  }
  return parsed;
}

export type BriefingEnvelope = { briefing: BriefingReadModel; fingerprint: string };

type AssetOpinionPerformanceRow = {
  symbol: string;
  horizonSessions: number;
  sampleSize: number | bigint;
  hitRate: unknown;
  averageReturn: unknown;
  averageExcessReturn: unknown;
};

function nullableDecimal(value: unknown): string | null {
  return value == null ? null : decimal(value);
}

async function loadAssetOpinionPerformance(
  context: TenantContext,
): Promise<Map<string, AssetOpinionPerformanceReadModel>> {
  const rows = await getPrisma().$queryRaw<AssetOpinionPerformanceRow[]>(Prisma.sql`
    SELECT asset.symbol,
           evaluation.horizon_sessions AS "horizonSessions",
           COUNT(*)::int AS "sampleSize",
           AVG(CASE WHEN evaluation.correct THEN 1.0 ELSE 0.0 END) AS "hitRate",
           AVG(evaluation.asset_return) AS "averageReturn",
           AVG(evaluation.excess_return) AS "averageExcessReturn"
    FROM asset_opinion_evaluations AS evaluation
    JOIN assets AS asset ON asset.id = evaluation.asset_id
    WHERE evaluation.organization_id = ${context.organizationId}::uuid
      AND evaluation.user_id = ${context.userId}::uuid
    GROUP BY asset.symbol, evaluation.horizon_sessions
    ORDER BY asset.symbol, evaluation.horizon_sessions
  `);
  const grouped = new Map<string, AssetOpinionPerformanceReadModel["horizons"]>();
  for (const row of rows) {
    if (row.horizonSessions !== 1 && row.horizonSessions !== 5 && row.horizonSessions !== 20)
      continue;
    const horizons = grouped.get(row.symbol) ?? [];
    horizons.push({
      horizonSessions: row.horizonSessions,
      sampleSize: Number(row.sampleSize),
      hitRate: nullableDecimal(row.hitRate),
      averageReturn: nullableDecimal(row.averageReturn),
      averageExcessReturn: nullableDecimal(row.averageExcessReturn),
    });
    grouped.set(row.symbol, horizons);
  }
  return new Map(
    [...grouped.entries()].map(([symbol, horizons]) => {
      const sampleSize = horizons.reduce((sum, row) => sum + row.sampleSize, 0);
      return [
        symbol,
        {
          status: sampleSize >= 20 ? "available" : "limited",
          horizons: horizons.slice(0, 3),
        },
      ];
    }),
  );
}

export async function loadBriefingEnvelope(
  context: TenantContext,
  localDate?: string | null,
): Promise<BriefingEnvelope | null> {
  const parsedDate = localDate ? new Date(`${localDate}T00:00:00.000Z`) : null;
  if (parsedDate && Number.isNaN(parsedDate.getTime()))
    throw new SmartInsightsInputError("Invalid local date.");
  const row = await getPrisma().dailyBriefing.findFirst({
    where: {
      organizationId: context.organizationId,
      userId: context.userId,
      ...(parsedDate ? { effectiveDate: parsedDate } : {}),
    },
    orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }],
    include: {
      items: {
        orderBy: { rank: "asc" },
        include: {
          signalSnapshot: { include: { asset: { select: { symbol: true, name: true } } } },
          aiInsight: { select: { title: true, summary: true, catalyst: true, risk: true } },
        },
      },
    },
  });
  if (!row) return null;
  const [previousRow, performanceBySymbol] = await Promise.all([
    getPrisma().dailyBriefing.findFirst({
      where: {
        organizationId: context.organizationId,
        userId: context.userId,
        effectiveDate: { lt: row.effectiveDate },
      },
      orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }],
      select: { marketSummary: true },
    }),
    loadAssetOpinionPerformance(context),
  ]);
  const legacyRows = row.items.filter((item) => item.signalSnapshot.signalType !== "asset_opinion");
  const items = legacyRows.map(briefingItem);
  const portfolio = object(row.portfolioSnapshot);
  const summary = object(row.marketSummary);
  const storedOpinions = Array.isArray(summary.assetOpinions) ? summary.assetOpinions : [];
  const assetOpinions = storedOpinions.slice(0, 25).map((item) => {
    let opinion: AssetOpinionReadModel;
    try {
      opinion = storedAssetOpinion(item);
    } catch {
      opinion = assetOpinionFallback(item);
    }
    return {
      ...opinion,
      performance: performanceBySymbol.get(opinion.symbol) ?? {
        status: "accumulating" as const,
        horizons: [],
      },
    };
  });
  const previousSummary = object(previousRow?.marketSummary);
  const previousStoredOpinions = Array.isArray(previousSummary.assetOpinions)
    ? previousSummary.assetOpinions
    : null;
  const previousOpinions = previousStoredOpinions
    ? previousStoredOpinions.slice(0, 25).flatMap((item) => {
        try {
          return [storedAssetOpinion(item)];
        } catch {
          return [];
        }
      })
    : null;
  const briefing: BriefingReadModel = {
    id: row.id,
    localDate: dateOnly(row.effectiveDate),
    revision: row.revision,
    generatedAt: row.effectiveAt.toISOString(),
    timezone: row.timezone,
    status: row.status as BriefingReadModel["status"],
    overallDataConfidence: decimal(row.dataConfidence),
    portfolioState: portfolio.portfolioState === "available" ? "available" : "missing",
    primary: items.filter((_, index) => {
      const section = legacyRows[index]?.section;
      return section === "primary" || section === "primary_change";
    }),
    riskAlerts: items.filter((_, index) => {
      const section = legacyRows[index]?.section;
      return section === "risk" || section === "risk_alert";
    }),
    assetOpinions,
    portfolioChanges: derivePortfolioOpinionChanges(assetOpinions, previousOpinions),
    portfolioChangesStatus: previousOpinions ? "ready" : "accumulating",
    sourceRunId: row.researchRunId,
  };
  return { briefing, fingerprint: row.fingerprint };
}

export async function loadBriefing(
  context: TenantContext,
  localDate?: string | null,
): Promise<BriefingReadModel | null> {
  return (await loadBriefingEnvelope(context, localDate))?.briefing ?? null;
}

export async function loadRegimes(): Promise<MarketRegimeReadModel[]> {
  const rows = await getPrisma().signalSnapshot.findMany({
    where: { signalType: "regime", market: { in: [...MARKETS] }, effectiveAt: { lte: new Date() } },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
    take: 60,
    include: { asset: { select: { symbol: true } } },
  });
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const key = `${row.market}:${row.assetId ?? "global"}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const inputs = Array.isArray(row.inputs) ? row.inputs : [];
    const state: FreshnessState =
      row.status !== "active" ? "unavailable" : Number(row.coverage) < 1 ? "partial" : "fresh";
    return [
      {
        id: row.id,
        market: row.market as InsightMarket,
        asset: row.asset?.symbol ?? null,
        score: row.score == null ? null : decimal(row.score),
        label: row.label as MarketRegimeReadModel["label"],
        dataConfidence: decimal(row.dataConfidence),
        coverage: decimal(row.coverage),
        effectiveAt: row.effectiveAt.toISOString(),
        methodologyVersion: row.methodologyVersion,
        freshness: state,
        groups: inputs.flatMap((input) => {
          if (!input || typeof input !== "object" || Array.isArray(input)) return [];
          const item = input as Record<string, unknown>;
          return [
            {
              metricCode: String(item.metricCode ?? ""),
              score: item.score == null ? null : String(item.score),
              weight: String(item.configuredWeight ?? "0"),
              observedAt: String(item.observedAt ?? row.effectiveAt.toISOString()),
              freshness: item.isFresh === false ? "stale" : "fresh",
            },
          ];
        }),
      },
    ];
  });
}

export async function loadMetrics(input: {
  market: InsightMarket;
  asset?: string | null;
  from: Date;
  to: Date;
}): Promise<MetricReadModel[]> {
  if (!MARKETS.has(input.market)) throw new SmartInsightsInputError("Market is not supported.");
  if (input.asset && !ASSET.test(input.asset))
    throw new SmartInsightsInputError("Asset is not supported.");
  if (input.to.getTime() - input.from.getTime() > 31 * 86_400_000)
    throw new SmartInsightsInputError("Date window must not exceed 31 days.");
  const rows = await getPrisma().metricObservation.findMany({
    where: {
      effectiveAt: { gte: input.from, lte: input.to },
      metricDefinition: { market: input.market },
      ...(input.asset ? { asset: { symbol: input.asset } } : {}),
    },
    orderBy: [{ effectiveAt: "desc" }, { revision: "desc" }],
    take: 5_000,
    include: {
      metricDefinition: true,
      provider: { select: { code: true } },
      asset: { select: { symbol: true } },
      rawSnapshot: { select: { sourceUrl: true } },
    },
  });
  const seenNaturalKeys = new Set<string>();
  const latestRows = rows.filter((row) => {
    if (seenNaturalKeys.has(row.naturalKey)) return false;
    seenNaturalKeys.add(row.naturalKey);
    return true;
  });
  return latestRows.map((row) => ({
    observationId: row.id,
    metricCode: row.metricDefinition.code,
    market: row.metricDefinition.market as InsightMarket,
    asset: row.asset?.symbol ?? null,
    value: decimal(row.value),
    unit: row.metricDefinition.unit,
    delta: null,
    percentile: null,
    effectiveStart: (row.effectiveStart ?? row.effectiveAt).toISOString(),
    effectiveEnd: (row.effectiveEnd ?? row.effectiveAt).toISOString(),
    observedAt: row.observedAt.toISOString(),
    sourceCode: row.provider.code,
    sourceUrl: row.rawSnapshot.sourceUrl,
    freshness: freshness(
      row.observedAt,
      row.metricDefinition.freshnessSlaMinutes,
      row.qualityStatus,
    ),
    qualityWarnings: strings(row.qualityFlags),
    methodologyVersion: row.metricDefinition.methodologyVersion,
  }));
}

export async function loadCalendar(input: {
  from: Date;
  to: Date;
  impact?: string | null;
}): Promise<CalendarEventReadModel[]> {
  if (input.impact && !IMPACTS.has(input.impact))
    throw new SmartInsightsInputError("Impact is not supported.");
  if (input.to.getTime() - input.from.getTime() > 31 * 86_400_000)
    throw new SmartInsightsInputError("Date window must not exceed 31 days.");
  const rows = await getPrisma().economicEvent.findMany({
    where: {
      eventDate: { gte: input.from, lte: input.to },
      ...(input.impact ? { impact: input.impact } : {}),
    },
    orderBy: [{ eventDate: "asc" }, { eventAt: "asc" }, { revision: "desc" }],
    take: 500,
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows)
    if (!latest.has(`${row.sourceCode}:${row.sourceEventKey}`))
      latest.set(`${row.sourceCode}:${row.sourceEventKey}`, row);
  return [...latest.values()].map((row) => ({
    id: row.id,
    event: row.event,
    country: row.country,
    currency: row.currency,
    impact: row.impact as CalendarEventReadModel["impact"],
    actual: row.actual,
    forecast: row.forecast,
    previous: row.previous,
    eventDate: dateOnly(row.eventDate),
    eventAt: row.eventAt?.toISOString() ?? null,
    timeStatus: row.timeStatus,
    surprise: null,
    portfolioRelevance: "0",
    sourceCode: row.sourceCode,
    sourceUrl: row.detailUrl ?? "https://www.cryptocraft.com/calendar",
    observedAt: row.observedAt.toISOString(),
    licenseScope: "research_only",
  }));
}

export async function loadEvidence(
  context: TenantContext,
  id: string,
): Promise<EvidenceDetailReadModel | null> {
  const row = await getPrisma().evidenceItem.findFirst({
    where: { id, researchRun: { organizationId: context.organizationId, userId: context.userId } },
    select: { id: true, excerpt: true, url: true },
  });
  if (!row) return null;
  try {
    const fact = JSON.parse(row.excerpt) as Record<string, unknown>;
    return {
      id: row.id,
      metricCode: String(fact.metric_code ?? ""),
      asset: typeof fact.asset === "string" ? fact.asset : null,
      rawValue: String(fact.raw_value ?? ""),
      displayValue: String(fact.display_value ?? ""),
      unit: String(fact.unit ?? ""),
      effectiveStart: String(fact.effective_start ?? ""),
      effectiveEnd: String(fact.effective_end ?? ""),
      observedAt: String(fact.observed_at ?? ""),
      sourceCode: String(fact.source_code ?? ""),
      sourceUrl: row.url,
      methodologyVersion: String(fact.methodology_version ?? ""),
      warnings: Array.isArray(fact.warnings) ? fact.warnings.map(String) : [],
      formula: typeof fact.format_rule === "string" ? fact.format_rule : null,
      history: [],
    };
  } catch {
    return null;
  }
}

function validatePreferences(value: unknown): InsightPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SmartInsightsInputError("Preference body is invalid.");
  const row = value as Record<string, unknown>;
  const markets = Array.isArray(row.markets) ? row.markets : [];
  const assets = Array.isArray(row.assets) ? row.assets : [];
  const alerts = row.alertPreferences;
  if (
    markets.some((market) => typeof market !== "string" || !MARKETS.has(market as InsightMarket)) ||
    assets.some((asset) => typeof asset !== "string" || !ASSET.test(asset)) ||
    !["vi", "en"].includes(String(row.locale)) ||
    !CURRENCY.test(String(row.baseCurrency)) ||
    !HORIZONS.has(String(row.investmentHorizon)) ||
    !RISKS.has(String(row.riskTolerance)) ||
    !alerts ||
    typeof alerts !== "object" ||
    Array.isArray(alerts) ||
    typeof (alerts as Record<string, unknown>).highImpact !== "boolean"
  )
    throw new SmartInsightsInputError("Preference body is invalid.");
  return {
    markets: [...new Set(markets)] as InsightMarket[],
    assets: [...new Set(assets as string[])],
    locale: row.locale as "vi" | "en",
    baseCurrency: String(row.baseCurrency),
    investmentHorizon: row.investmentHorizon as InsightPreferences["investmentHorizon"],
    riskTolerance: row.riskTolerance as InsightPreferences["riskTolerance"],
    alertPreferences: { highImpact: (alerts as Record<string, boolean>).highImpact },
  };
}

export async function loadPreferences(
  context: TenantContext,
  canWrite: boolean,
): Promise<InsightPreferencesResponse> {
  const row = await getPrisma().userInsightPreference.findUnique({
    where: {
      organizationId_userId: { organizationId: context.organizationId, userId: context.userId },
    },
  });
  if (!row) return { preference: DEFAULT_INSIGHT_PREFERENCES, persisted: false, canWrite };
  return {
    preference: {
      markets: strings(row.markets) as InsightMarket[],
      assets: strings(row.assets),
      locale: row.locale as "vi" | "en",
      baseCurrency: row.baseCurrency,
      investmentHorizon: row.investmentHorizon as InsightPreferences["investmentHorizon"],
      riskTolerance: row.riskTolerance as InsightPreferences["riskTolerance"],
      alertPreferences: { highImpact: object(row.alertPreferences).highImpact !== false },
    },
    persisted: true,
    canWrite,
  };
}

export async function savePreferences(
  context: TenantContext,
  input: unknown,
): Promise<InsightPreferencesResponse> {
  const preference = validatePreferences(input);
  await getPrisma().userInsightPreference.upsert({
    where: {
      organizationId_userId: { organizationId: context.organizationId, userId: context.userId },
    },
    create: { organizationId: context.organizationId, userId: context.userId, ...preference },
    update: preference,
  });
  return { preference, persisted: true, canWrite: true };
}
