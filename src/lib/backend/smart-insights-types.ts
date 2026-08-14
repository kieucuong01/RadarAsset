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
  collectionMode: "api" | "scrapling" | "manual" | "disabled";
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

export type Availability = "AVAILABLE" | "STALE" | "LIMITED_DATA" | "UNAVAILABLE";

export type MacroEventRow = {
  id: string;
  category: string;
  subcategory: string | null;
  title: string;
  country: string | null;
  region: string | null;
  occurredAt: string;
  severity: number | null;
  corroborationCount: number;
  status: string;
  qualityFlags: string[];
  sources: Array<{
    sourceCode: string;
    sourceUrl: string | null;
    observedAt: string;
  }>;
};

export type MacroEventRiskView = {
  generatedAt: string;
  methodology: "macro-event-risk-v1";
  status: Availability;
  score: number | null;
  freshWeight: number;
  asOf: string;
  components: Array<{
    code: string;
    value: number | null;
    weight: number;
    fresh: boolean;
    evidenceIds: string[];
  }>;
  timeline: Array<{ ts: string; score: number; category: string }>;
  events: MacroEventRow[];
  assetImpacts: Array<{
    asset: "BTC" | "XAU";
    direction: "headwind" | "tailwind";
    score: number;
    methodology: "macro-event-asset-impact-v1";
  }>;
};

export type EnergyPulseView = {
  generatedAt: string;
  methodology: "energy-oil-shock-v1";
  status: Availability;
  oilShockScore: number | null;
  freshWeight: number;
  asOf: string;
  cards: Array<{
    code: "brent" | "wti" | "spread" | "oil_shock";
    label: string;
    value: number | null;
    unit: string;
    asOf: string | null;
  }>;
  priceSeries: Array<{ ts: string; brent: number | null; wti: number | null }>;
  inventoryProduction: Array<{
    ts: string;
    inventory: number | null;
    production: number | null;
  }>;
  evidence: Array<{
    observationId: string;
    metricCode: string;
    sourceCode: string;
    sourceUrl: string | null;
    observedAt: string;
  }>;
};

export type KronosShadowView = {
  asset: "BTC";
  model: "kronos-small";
  state: "ACCUMULATING" | "READY_SHADOW" | "FAILED" | "UNAVAILABLE";
  decisionUse: "NONE";
  completedOos: number;
  minimumOos: 180;
  generatedAt: string | null;
  modelRevision: string | null;
  forecasts: Array<{
    days: 1 | 3 | 7;
    median: number;
    lower: number;
    upper: number;
    forecastFor: string;
  }>;
  metrics: Array<{
    model: string;
    mae: number;
    mase: number;
    directionalAccuracy: number;
    spearmanIc: number;
    intervalCoverage: number | null;
    calibrationError: number | null;
  }>;
  rollingErrors: Array<{
    ts: string;
    horizon: number;
    model: string;
    absoluteError: number;
    directionCorrect: boolean;
    volatilityRegime: "LOW" | "NORMAL" | "HIGH";
  }>;
  history: Array<{
    generatedAt: string;
    forecastFor: string;
    days: 1 | 3 | 7;
    predicted: number;
    realized: number;
  }>;
  methodology: "kronos-btc-shadow-v1";
};
