export type SmartInsightSourceHealth = {
  sourceCode: string;
  sourceName: string;
  market: "crypto" | "macro" | "gold";
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
