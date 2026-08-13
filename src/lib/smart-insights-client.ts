import { z } from "zod";

const decimal = z.string();
const market = z.enum(["crypto", "macro", "gold"]);
const freshness = z.enum(["fresh", "stale", "conflicting", "partial", "unavailable"]);

const relevanceSchema = z.object({
  exposure: decimal,
  magnitude: decimal,
  proximity: decimal,
  interest: decimal,
  dataConfidence: decimal,
});

const briefingItemSchema = z.object({
  id: z.string(),
  signalId: z.string(),
  market,
  asset: z.string().nullable(),
  signalType: z.string(),
  regimeLabel: z.string(),
  score: decimal.nullable(),
  headline: z.string().nullable(),
  whatChanged: z.string().nullable(),
  whyItMatters: z.string().nullable(),
  explanationStatus: z.enum(["accepted", "unavailable", "rejected"]),
  suggestedCheckTemplate: z.string(),
  confidence: decimal,
  relevanceScore: decimal,
  relevanceComponents: relevanceSchema,
  supportingEvidenceIds: z.array(z.string()),
  contradictingEvidenceIds: z.array(z.string()),
  affectedAssets: z.array(z.string()),
  timeHorizon: z.string(),
  riskScenarios: z.array(z.string()),
});

export const briefingSchema = z.object({
  id: z.string(),
  localDate: z.string(),
  revision: z.number().int().positive(),
  generatedAt: z.string(),
  timezone: z.string(),
  status: z.enum(["complete", "partial", "quant_only"]),
  overallDataConfidence: decimal,
  portfolioState: z.enum(["available", "missing"]),
  primary: z.array(briefingItemSchema),
  riskAlerts: z.array(briefingItemSchema),
  sourceRunId: z.string(),
});

const regimeGroupSchema = z.object({
  metricCode: z.string(),
  score: decimal.nullable(),
  weight: decimal,
  observedAt: z.string(),
  freshness,
});

export const regimesSchema = z.object({
  regimes: z.array(
    z.object({
      id: z.string(),
      market,
      asset: z.string().nullable(),
      score: decimal.nullable(),
      label: z.string(),
      dataConfidence: decimal,
      coverage: decimal,
      effectiveAt: z.string(),
      methodologyVersion: z.string(),
      freshness,
      groups: z.array(regimeGroupSchema),
    }),
  ),
});

export const metricsSchema = z.object({
  metrics: z.array(
    z.object({
      observationId: z.string(),
      metricCode: z.string(),
      market,
      asset: z.string().nullable(),
      value: decimal,
      unit: z.string(),
      delta: decimal.nullable(),
      percentile: decimal.nullable(),
      effectiveStart: z.string(),
      effectiveEnd: z.string(),
      observedAt: z.string(),
      sourceCode: z.string(),
      sourceUrl: z.string(),
      freshness,
      qualityWarnings: z.array(z.string()),
      methodologyVersion: z.string(),
    }),
  ),
});

export const calendarSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      event: z.string(),
      country: z.string(),
      currency: z.string(),
      impact: z.enum(["high", "medium", "low"]),
      actual: z.string().nullable(),
      forecast: z.string().nullable(),
      previous: z.string().nullable(),
      eventDate: z.string(),
      eventAt: z.string().nullable(),
      timeStatus: z.string(),
      surprise: z.string().nullable(),
      portfolioRelevance: decimal,
      sourceCode: z.string(),
      sourceUrl: z.string(),
      observedAt: z.string(),
      licenseScope: z.string(),
    }),
  ),
});

export const evidenceSchema = z.object({
  id: z.string(),
  metricCode: z.string(),
  asset: z.string().nullable(),
  rawValue: z.string(),
  displayValue: z.string(),
  unit: z.string(),
  effectiveStart: z.string(),
  effectiveEnd: z.string(),
  observedAt: z.string(),
  sourceCode: z.string(),
  sourceUrl: z.string().nullable(),
  methodologyVersion: z.string(),
  warnings: z.array(z.string()),
  formula: z.string().nullable(),
  history: z.array(z.object({ effectiveAt: z.string(), value: z.string() })),
});

export const preferencesSchema = z.object({
  preference: z.object({
    markets: z.array(market),
    assets: z.array(z.string()),
    locale: z.enum(["vi", "en"]),
    baseCurrency: z.string(),
    investmentHorizon: z.enum(["INTRADAY", "DAYS_1_7", "WEEKS_1_4", "MONTHS_1_3"]),
    riskTolerance: z.enum(["conservative", "moderate", "aggressive"]),
    alertPreferences: z.object({ highImpact: z.boolean() }),
  }),
  persisted: z.boolean(),
  canWrite: z.boolean(),
});

export const healthSchema = z.object({
  generatedAt: z.string(),
  sources: z.array(
    z.object({
      sourceCode: z.string(),
      sourceName: z.string(),
      market,
      collectionMode: z.string(),
      parserVersion: z.string(),
      lastEffectiveAt: z.string().nullable(),
      lastObservedAt: z.string().nullable(),
      lastStatus: z.enum(["validated", "quarantined", "unavailable"]),
      lastErrorCode: z.string().nullable(),
      freshness: z.enum(["FRESH", "STALE", "UNAVAILABLE"]),
    }),
  ),
});

export type BriefingModel = z.infer<typeof briefingSchema>;
export type BriefingItemModel = z.infer<typeof briefingItemSchema>;
export type RegimeModel = z.infer<typeof regimesSchema>["regimes"][number];
export type MetricModel = z.infer<typeof metricsSchema>["metrics"][number];
export type CalendarModel = z.infer<typeof calendarSchema>["events"][number];
export type EvidenceModel = z.infer<typeof evidenceSchema>;
export type PreferencesModel = z.infer<typeof preferencesSchema>;
export type HealthModel = z.infer<typeof healthSchema>;

export async function fetchParsed<T>(
  url: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Smart Insights request failed (${response.status}).`);
  return schema.parse(await response.json());
}

export async function putPreferences(
  value: PreferencesModel["preference"],
): Promise<PreferencesModel> {
  const response = await fetch("/api/smart-insights/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`Preference update failed (${response.status}).`);
  return preferencesSchema.parse(await response.json());
}
