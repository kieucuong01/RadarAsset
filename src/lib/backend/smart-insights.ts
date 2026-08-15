import type { Prisma } from "@prisma/client";

import type { TenantContext } from "@/lib/auth/tenant-context";
import { getPrisma } from "@/lib/db/prisma";

import type {
  AssetOpinionEvidenceReadModel,
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
const HORIZONS = new Set(["INTRADAY", "DAYS_1_7", "WEEKS_1_4", "MONTHS_1_3"]);
const RISKS = new Set(["conservative", "moderate", "aggressive"]);
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

type AssetOpinionItemRow = {
  id: string;
  signalSnapshotId: string;
  supportingEvidenceIds: Prisma.JsonValue;
  contradictingEvidenceIds: Prisma.JsonValue;
  affectedAssets: Prisma.JsonValue;
  timeHorizon: string;
  suggestedCheckTemplate: string;
  explanationStatus: string;
  confidence: unknown;
  signalSnapshot: {
    score: unknown;
    label: string;
    coverage: unknown;
    inputs: Prisma.JsonValue;
    asset: { symbol: string; name: string } | null;
  };
  aiInsight: {
    title: string;
    summary: string;
    catalyst: string | null;
    risk: string | null;
  } | null;
};

type EvidenceRow = { id: string; excerpt: string };

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function assetFreshness(value: unknown): FreshnessState {
  return value === "fresh" || value === "stale" || value === "conflicting" ||
    value === "partial" || value === "unavailable"
    ? value
    : "unavailable";
}

function assetOpinionFallback(row: AssetOpinionItemRow): AssetOpinionReadModel {
  const symbol = row.signalSnapshot.asset?.symbol ?? strings(row.affectedAssets)[0] ?? "UNKNOWN";
  return {
    symbol,
    assetName: row.signalSnapshot.asset?.name ?? symbol,
    stance: row.signalSnapshot.label || "INSUFFICIENT_DATA",
    quantScore: row.signalSnapshot.score == null ? null : decimal(row.signalSnapshot.score),
    confidence: decimal(row.confidence),
    horizon: row.timeHorizon,
    portfolioWeightPct: "0",
    personalizedAction: "NO_ACTION_INSUFFICIENT_DATA",
    pillars: [],
    thesis: null,
    bullCase: null,
    baseCase: null,
    bearCase: null,
    invalidationConditions: [],
    evidence: [],
    dataCoverage: decimal(row.signalSnapshot.coverage),
    freshness: "unavailable",
    explanationStatus: "unavailable",
    failedGates: ["STORED_CONTRACT_INVALID"],
  };
}

function parseEvidence(
  row: EvidenceRow,
  supporting: Set<string>,
  contradicting: Set<string>,
): AssetOpinionEvidenceReadModel | null {
  try {
    const fact = JSON.parse(row.excerpt) as Record<string, unknown>;
    const warnings = Array.isArray(fact.warnings) ? fact.warnings : [];
    return {
      id: row.id,
      metricCode: String(fact.metric_code ?? ""),
      displayValue: String(fact.display_value ?? fact.raw_value ?? ""),
      delta: fact.delta == null ? null : String(fact.delta),
      percentile: fact.percentile == null ? null : String(fact.percentile),
      impact: supporting.has(row.id)
        ? "supporting"
        : contradicting.has(row.id)
          ? "contradicting"
          : "neutral",
      sourceCode: String(fact.source_code ?? ""),
      sourceUrl: String(fact.source_url ?? ""),
      effectiveAt: String(fact.effective_end ?? fact.effective_start ?? ""),
      observedAt: String(fact.observed_at ?? ""),
      freshness: warnings.includes("STALE") ? "stale" : "fresh",
    };
  } catch {
    return null;
  }
}

function assetOpinion(
  row: AssetOpinionItemRow,
  evidenceById: ReadonlyMap<string, EvidenceRow>,
): AssetOpinionReadModel {
  try {
    const inputs = object(row.signalSnapshot.inputs);
    if (!Array.isArray(inputs.pillars)) throw new Error("Invalid pillars.");
    const gate = object(inputs.gate as Prisma.JsonValue);
    const supportingIds = strings(row.supportingEvidenceIds);
    const contradictingIds = strings(row.contradictingEvidenceIds);
    const supporting = new Set(supportingIds);
    const contradicting = new Set(contradictingIds);
    const evidence = [...supportingIds, ...contradictingIds]
      .filter((id, index, all) => all.indexOf(id) === index)
      .flatMap((id) => {
        const source = evidenceById.get(id);
        if (!source) return [];
        const parsed = parseEvidence(source, supporting, contradicting);
        return parsed ? [parsed] : [];
      });
    const risk = row.aiInsight?.risk ? JSON.parse(row.aiInsight.risk) as Record<string, unknown> : {};
    const pillars = inputs.pillars.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid pillar.");
      const item = raw as Record<string, unknown>;
      if (!Array.isArray(item.fact_ids) || !Array.isArray(item.series)) {
        throw new Error("Invalid pillar fields.");
      }
      return {
        code: String(item.code ?? ""),
        score: item.score == null ? null : String(item.score),
        weight: String(item.configured_weight ?? "0"),
        confidence: String(item.confidence ?? "0"),
        factIds: item.fact_ids.filter((value): value is string => typeof value === "string"),
        series: item.series.map((point) => {
          if (!Array.isArray(point) || point.length !== 2) throw new Error("Invalid series point.");
          const value = finiteNumber(point[1]);
          if (value == null) throw new Error("Invalid series value.");
          return { ts: String(point[0]), value };
        }),
      };
    });
    const symbol = row.signalSnapshot.asset?.symbol ?? strings(row.affectedAssets)[0];
    if (!symbol) throw new Error("Missing asset symbol.");
    const status = row.explanationStatus;
    const explanationStatus: AssetOpinionReadModel["explanationStatus"] =
      status === "accepted" || status === "quant_only" || status === "insufficient_data" ||
      status === "unavailable"
        ? status
        : "unavailable";
    return {
      symbol,
      assetName: String(inputs.assetName ?? row.signalSnapshot.asset?.name ?? symbol),
      stance: row.signalSnapshot.label,
      quantScore: row.signalSnapshot.score == null ? null : decimal(row.signalSnapshot.score),
      confidence: decimal(row.confidence),
      horizon: row.timeHorizon,
      portfolioWeightPct: String(inputs.portfolioWeightPct ?? "0"),
      personalizedAction: row.suggestedCheckTemplate,
      pillars,
      thesis: row.aiInsight?.title ?? null,
      bullCase: row.aiInsight?.catalyst ?? null,
      baseCase: row.aiInsight?.summary ?? null,
      bearCase: risk.bearCase == null ? null : String(risk.bearCase),
      invalidationConditions: Array.isArray(risk.invalidationConditions)
        ? risk.invalidationConditions.filter((value): value is string => typeof value === "string")
        : [],
      evidence,
      dataCoverage: decimal(row.signalSnapshot.coverage),
      freshness: assetFreshness(inputs.freshness),
      explanationStatus,
      failedGates: strings(gate.failed_gates as Prisma.JsonValue),
    };
  } catch {
    return assetOpinionFallback(row);
  }
}

export type BriefingEnvelope = { briefing: BriefingReadModel; fingerprint: string };

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
  const legacyRows = row.items.filter((item) => item.section !== "asset_opinion");
  const opinionRows = row.items.filter((item) => item.section === "asset_opinion");
  const evidenceIds = opinionRows.flatMap((item) => [
    ...strings(item.supportingEvidenceIds),
    ...strings(item.contradictingEvidenceIds),
  ]);
  const evidenceRows = evidenceIds.length
    ? await getPrisma().evidenceItem.findMany({
        where: {
          id: { in: [...new Set(evidenceIds)] },
          researchRun: { organizationId: context.organizationId, userId: context.userId },
        },
        select: { id: true, excerpt: true },
      })
    : [];
  const evidenceById = new Map(evidenceRows.map((item) => [item.id, item]));
  const items = legacyRows.map(briefingItem);
  const portfolio = object(row.portfolioSnapshot);
  const briefing: BriefingReadModel = {
    id: row.id,
    localDate: dateOnly(row.effectiveDate),
    revision: row.revision,
    generatedAt: row.effectiveAt.toISOString(),
    timezone: row.timezone,
    status: row.status as BriefingReadModel["status"],
    overallDataConfidence: decimal(row.dataConfidence),
    portfolioState: portfolio.portfolioState === "available" ? "available" : "missing",
    primary: items.filter((_, index) => legacyRows[index]?.section === "primary"),
    riskAlerts: items.filter((_, index) => legacyRows[index]?.section === "risk"),
    assetOpinions: opinionRows.map((item) => assetOpinion(item, evidenceById)),
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
