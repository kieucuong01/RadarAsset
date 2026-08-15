import { z } from "zod";

const decimal = z.string().regex(/^-?(?:\d+|\d*\.\d+)$/);
const timestamp = z.string().datetime({ offset: true });
const market = z.enum(["crypto", "macro", "gold"]);
const freshness = z.enum(["fresh", "stale", "conflicting", "partial", "unavailable"]);
const assetStance = z.enum([
  "POSITIVE",
  "CONSTRUCTIVE",
  "NEUTRAL",
  "CAUTIOUS",
  "NEGATIVE",
  "INSUFFICIENT_DATA",
]);
const assetHorizon = z.enum(["INTRADAY", "DAYS_1_7", "WEEKS_1_4", "MONTHS_1_3"]);
const assetAction = z.enum([
  "HOLD",
  "REVIEW_INCREASE",
  "REVIEW_REDUCE_RISK",
  "WAIT_CONFIRMATION",
  "NO_ACTION_INSUFFICIENT_DATA",
]);
const riskTolerance = z.enum(["conservative", "moderate", "aggressive"]);

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

const assetOpinionSchema = z
  .object({
    symbol: z.string().min(1),
    assetName: z.string().min(1),
    stance: assetStance,
    quantScore: decimal.nullable(),
    confidence: decimal,
    horizon: assetHorizon,
    portfolioWeightPct: decimal,
    unrealizedReturn: decimal.nullable(),
    riskTolerance,
    personalizedAction: assetAction,
    pillars: z.array(
      z
        .object({
          code: z.string().min(1),
          score: decimal.nullable(),
          weight: decimal,
          confidence: decimal,
          factIds: z.array(z.string().min(1)),
          series: z.array(z.object({ ts: timestamp, value: z.number().finite() }).strict()),
        })
        .strict(),
    ),
    thesis: z.string().min(1).nullable(),
    bullCase: z.string().min(1).nullable(),
    baseCase: z.string().min(1).nullable(),
    bearCase: z.string().min(1).nullable(),
    invalidationConditions: z.array(z.string().min(1)),
    evidence: z.array(
      z
        .object({
          id: z.string().min(1),
          metricCode: z.string().min(1),
          displayValue: z.string(),
          delta: decimal.nullable(),
          percentile: decimal.nullable(),
          impact: z.enum(["supporting", "contradicting", "neutral"]),
          sourceCode: z.string().min(1),
          sourceUrl: z.string().url(),
          effectiveAt: timestamp,
          observedAt: timestamp,
          freshness,
        })
        .strict(),
    ),
    dataCoverage: decimal,
    freshness,
    explanationStatus: z.enum(["accepted", "quant_only", "insufficient_data", "unavailable"]),
    failedGates: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((opinion, context) => {
    if (opinion.explanationStatus === "accepted") {
      if (opinion.freshness !== "fresh") {
        context.addIssue({
          code: "custom",
          path: ["freshness"],
          message: "Accepted data must be fresh.",
        });
      }
      for (const field of ["thesis", "bullCase", "baseCase", "bearCase"] as const) {
        if (!opinion[field]) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: "Accepted AI prose is required.",
          });
        }
      }
      if (opinion.invalidationConditions.length === 0 || opinion.evidence.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["explanationStatus"],
          message: "Accepted opinions require evidence and invalidation conditions.",
        });
      }
    }
    if (
      (opinion.explanationStatus === "insufficient_data" ||
        opinion.explanationStatus === "unavailable") &&
      opinion.personalizedAction !== "NO_ACTION_INSUFFICIENT_DATA"
    ) {
      context.addIssue({
        code: "custom",
        path: ["personalizedAction"],
        message: "Insufficient opinions cannot recommend an action.",
      });
    }
    if (
      opinion.explanationStatus !== "accepted" &&
      (opinion.thesis !== null ||
        opinion.bullCase !== null ||
        opinion.baseCase !== null ||
        opinion.bearCase !== null ||
        opinion.invalidationConditions.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["explanationStatus"],
        message: "Non-accepted opinions cannot contain AI prose.",
      });
    }
  });

export const briefingSchema = z
  .object({
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
    assetOpinions: z.array(assetOpinionSchema),
    sourceRunId: z.string(),
  })
  .strict();

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

const availability = z.enum(["AVAILABLE", "STALE", "LIMITED_DATA", "UNAVAILABLE"]);

export const macroEventRiskSchema = z.object({
  generatedAt: z.string(),
  methodology: z.literal("macro-event-risk-v1"),
  status: availability,
  score: z.number().nullable(),
  freshWeight: z.number().min(0).max(1),
  asOf: z.string(),
  components: z.array(
    z.object({
      code: z.string(),
      value: z.number().nullable(),
      weight: z.number().min(0).max(1),
      fresh: z.boolean(),
      evidenceIds: z.array(z.string()),
    }),
  ),
  timeline: z.array(z.object({ ts: z.string(), score: z.number(), category: z.string() })),
  events: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      subcategory: z.string().nullable(),
      title: z.string(),
      country: z.string().nullable(),
      region: z.string().nullable(),
      occurredAt: z.string(),
      severity: z.number().nullable(),
      corroborationCount: z.number().int().positive(),
      status: z.string(),
      qualityFlags: z.array(z.string()),
      sources: z.array(
        z.object({
          sourceCode: z.string(),
          sourceUrl: z.string().nullable(),
          observedAt: z.string(),
        }),
      ),
    }),
  ),
  assetImpacts: z.array(
    z.object({
      asset: z.enum(["BTC", "XAU"]),
      direction: z.enum(["headwind", "tailwind"]),
      score: z.number(),
      methodology: z.literal("macro-event-asset-impact-v1"),
    }),
  ),
});

export const energyPulseSchema = z.object({
  generatedAt: z.string(),
  methodology: z.literal("energy-oil-shock-v1"),
  status: availability,
  oilShockScore: z.number().nullable(),
  freshWeight: z.number().min(0).max(1),
  asOf: z.string(),
  cards: z.array(
    z.object({
      code: z.enum(["brent", "wti", "spread", "oil_shock"]),
      label: z.string(),
      value: z.number().nullable(),
      unit: z.string(),
      asOf: z.string().nullable(),
    }),
  ),
  priceSeries: z.array(
    z.object({ ts: z.string(), brent: z.number().nullable(), wti: z.number().nullable() }),
  ),
  inventoryProduction: z.array(
    z.object({
      ts: z.string(),
      inventory: z.number().nullable(),
      production: z.number().nullable(),
    }),
  ),
  evidence: z.array(
    z.object({
      observationId: z.string(),
      metricCode: z.string(),
      sourceCode: z.string(),
      sourceUrl: z.string().nullable(),
      observedAt: z.string(),
    }),
  ),
});

export const kronosShadowSchema = z.object({
  asset: z.literal("BTC"),
  model: z.literal("kronos-small"),
  state: z.enum(["ACCUMULATING", "READY_SHADOW", "FAILED", "UNAVAILABLE"]),
  decisionUse: z.literal("NONE"),
  completedOos: z.number().int().nonnegative(),
  minimumOos: z.literal(180),
  generatedAt: z.string().nullable(),
  modelRevision: z.string().nullable(),
  forecasts: z.array(
    z.object({
      days: z.union([z.literal(1), z.literal(3), z.literal(7)]),
      median: z.number().positive(),
      lower: z.number().positive(),
      upper: z.number().positive(),
      forecastFor: z.string(),
    }),
  ),
  metrics: z.array(
    z.object({
      model: z.string(),
      mae: z.number().nonnegative(),
      mase: z.number().nonnegative(),
      directionalAccuracy: z.number().min(0).max(1),
      spearmanIc: z.number().min(-1).max(1),
      intervalCoverage: z.number().min(0).max(1).nullable(),
      calibrationError: z.number().min(0).max(1).nullable(),
    }),
  ),
  rollingErrors: z.array(
    z.object({
      ts: z.string(),
      horizon: z.number().int().positive(),
      model: z.string(),
      absoluteError: z.number().nonnegative(),
      directionCorrect: z.boolean(),
      volatilityRegime: z.enum(["LOW", "NORMAL", "HIGH"]),
    }),
  ),
  history: z.array(
    z.object({
      generatedAt: z.string(),
      forecastFor: z.string(),
      days: z.union([z.literal(1), z.literal(3), z.literal(7)]),
      predicted: z.number().positive(),
      realized: z.number().positive(),
    }),
  ),
  methodology: z.literal("kronos-btc-shadow-v1"),
});

export type BriefingModel = z.infer<typeof briefingSchema>;
export type BriefingItemModel = z.infer<typeof briefingItemSchema>;
export type AssetOpinionModel = z.infer<typeof assetOpinionSchema>;
export type RegimeModel = z.infer<typeof regimesSchema>["regimes"][number];
export type MetricModel = z.infer<typeof metricsSchema>["metrics"][number];
export type CalendarModel = z.infer<typeof calendarSchema>["events"][number];
export type EvidenceModel = z.infer<typeof evidenceSchema>;
export type PreferencesModel = z.infer<typeof preferencesSchema>;
export type HealthModel = z.infer<typeof healthSchema>;
export type MacroEventRiskModel = z.infer<typeof macroEventRiskSchema>;
export type EnergyPulseModel = z.infer<typeof energyPulseSchema>;
export type KronosShadowModel = z.infer<typeof kronosShadowSchema>;

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
