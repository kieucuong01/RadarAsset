export type InsightMarket = "crypto" | "macro" | "gold";
export type FreshnessState = "fresh" | "stale" | "conflicting" | "partial" | "unavailable";
export type RegimeLabel =
  | "strongly_negative"
  | "negative"
  | "neutral"
  | "constructive"
  | "strongly_positive"
  | "risk_on"
  | "risk_off"
  | "defensive"
  | "unavailable";

export type RelevanceComponents = {
  exposure: string;
  magnitude: string;
  proximity: string;
  interest: string;
  dataConfidence: string;
};

export type BriefingItemReadModel = {
  id: string;
  signalId: string;
  market: InsightMarket;
  asset: string | null;
  signalType: string;
  regimeLabel: string;
  score: string | null;
  headline: string | null;
  whatChanged: string | null;
  whyItMatters: string | null;
  explanationStatus: "accepted" | "unavailable" | "rejected";
  suggestedCheckTemplate: string;
  confidence: string;
  relevanceScore: string;
  relevanceComponents: RelevanceComponents;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  affectedAssets: string[];
  timeHorizon: string;
  riskScenarios: string[];
};

export type BriefingReadModel = {
  id: string;
  localDate: string;
  revision: number;
  generatedAt: string;
  timezone: string;
  status: "complete" | "partial" | "quant_only";
  overallDataConfidence: string;
  portfolioState: "available" | "missing";
  primary: BriefingItemReadModel[];
  riskAlerts: BriefingItemReadModel[];
  sourceRunId: string;
};

export type RegimeGroupReadModel = {
  metricCode: string;
  score: string | null;
  weight: string;
  observedAt: string;
  freshness: FreshnessState;
};

export type MarketRegimeReadModel = {
  id: string;
  market: InsightMarket;
  asset: string | null;
  score: string | null;
  label: RegimeLabel;
  dataConfidence: string;
  coverage: string;
  effectiveAt: string;
  methodologyVersion: string;
  freshness: FreshnessState;
  groups: RegimeGroupReadModel[];
};

export type MetricReadModel = {
  observationId: string;
  metricCode: string;
  market: InsightMarket;
  asset: string | null;
  value: string;
  unit: string;
  delta: string | null;
  percentile: string | null;
  effectiveStart: string;
  effectiveEnd: string;
  observedAt: string;
  sourceCode: string;
  sourceUrl: string;
  freshness: FreshnessState;
  qualityWarnings: string[];
  methodologyVersion: string;
};

export type CalendarEventReadModel = {
  id: string;
  event: string;
  country: string;
  currency: string;
  impact: "high" | "medium" | "low";
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  eventDate: string;
  eventAt: string | null;
  timeStatus: string;
  surprise: string | null;
  portfolioRelevance: string;
  sourceCode: string;
  sourceUrl: string;
  observedAt: string;
  licenseScope: string;
};

export type EvidenceDetailReadModel = {
  id: string;
  metricCode: string;
  asset: string | null;
  rawValue: string;
  displayValue: string;
  unit: string;
  effectiveStart: string;
  effectiveEnd: string;
  observedAt: string;
  sourceCode: string;
  sourceUrl: string | null;
  methodologyVersion: string;
  warnings: string[];
  formula: string | null;
  history: Array<{ effectiveAt: string; value: string }>;
};

export type InsightPreferences = {
  markets: InsightMarket[];
  assets: string[];
  locale: "vi" | "en";
  baseCurrency: string;
  investmentHorizon: "INTRADAY" | "DAYS_1_7" | "WEEKS_1_4" | "MONTHS_1_3";
  riskTolerance: "conservative" | "moderate" | "aggressive";
  alertPreferences: { highImpact: boolean };
};

export type InsightPreferencesResponse = {
  preference: InsightPreferences;
  persisted: boolean;
  canWrite: boolean;
};

export type SmartInsightSourceHealth = {
  sourceCode: string;
  sourceName: string;
  market: InsightMarket;
  collectionMode: "api" | "firecrawl" | "manual" | "disabled";
  parserVersion: string;
  lastEffectiveAt: string | null;
  lastObservedAt: string | null;
  lastStatus: "validated" | "quarantined" | "unavailable";
  lastErrorCode: string | null;
  freshness: "FRESH" | "STALE" | "UNAVAILABLE";
};

export type SmartInsightsDataHealthResponse = {
  generatedAt: string;
  sources: SmartInsightSourceHealth[];
};
