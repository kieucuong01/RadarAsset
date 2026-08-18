export type AssetClass = "crypto" | "equity" | "etf" | "index" | "fx" | "commodity" | "cash";

export type TransactionType = "buy" | "sell";

export type PortfolioTimeframe = "1W" | "1M" | "YTD" | "1Y";

export type PortfolioChartTimeframe = PortfolioTimeframe | "ALL";

export type QuantRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "cancelled"
  | "timed_out";

export type MarketDataMarket = "crypto_spot" | "vn_equity" | "metal_spot";

export type MarketDataTimeframe = "1d";

export type MarketDataFreshness = "fresh" | "stale" | "unavailable" | "fixture";

export type MarketIngestionStatus =
  | "running"
  | "succeeded"
  | "unchanged"
  | "skipped"
  | "failed"
  | "unavailable";

export type MarketDataHealthItem = {
  symbol: string;
  market: MarketDataMarket;
  timeframe: MarketDataTimeframe;
  providerCode: string | null;
  providerName: string | null;
  upstreamProvider: string | null;
  datasetVersionId: string | null;
  version: number | null;
  rowCount: number;
  coverageStart: string | null;
  coverageEnd: string | null;
  publishedAt: string | null;
  lastIngestionStatus: MarketIngestionStatus | null;
  lastErrorCode: string | null;
  freshness: MarketDataFreshness;
};

export type QuantAssetCatalogItem = {
  symbol: string;
  name: string;
  market: MarketDataMarket;
  venue: string | null;
  currency: string;
  maxLeverage: number;
  timeframe: MarketDataTimeframe;
  datasetVersionId: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  rowCount: number;
  freshness: MarketDataFreshness;
  backtestable: boolean;
  reasonCode:
    | "DATASET_UNAVAILABLE"
    | "DATASET_RANGE_INSUFFICIENT"
    | "DATASET_PROVIDER_GAP"
    | "DATASET_CALENDAR_UNVERIFIED"
    | null;
  calendarVersion: string | null;
  qualityIssueCount: number;
  blockingQualityIssueCount: number;
  catalogCoverage: {
    firstObservedAt: string | null;
    completeForRequestedRange: boolean;
    warningCode: "SURVIVORSHIP_COVERAGE_PARTIAL" | null;
  };
  listingStatus: "active" | "inactive" | "delisted" | "unknown";
  availableAdjustments: Array<"raw" | "total_return">;
};

export type QuantAssetCatalogResponse = {
  items: QuantAssetCatalogItem[];
};

export type QuantDataReadinessResponse = {
  readyForBacktest: boolean;
  instrumentsByMarket: Record<MarketDataMarket, number>;
  activeDatasetsByMarketTimeframe: Array<{
    market: MarketDataMarket;
    timeframe: MarketDataTimeframe;
    count: number;
  }>;
  ingestionRequestsByStatusTimeframe: Array<{
    status: string;
    timeframe: MarketDataTimeframe;
    count: number;
  }>;
  backlogCount: number;
  dueBacklogCount: number;
  expectedDatasetCount: number;
  missingDatasetCount: number;
  staleDatasetCount: number;
  missingBarCount: number;
  oldestBacklogAt: string | null;
  oldestDueBacklogAt: string | null;
  workerHeartbeatAt: string | null;
  workerStatus: "active" | "stale" | "unavailable";
  lastSchedulerSuccessAt: string | null;
  latestSchedulerRun: {
    command: "daily" | "all";
    status: "running" | "succeeded" | "failed";
    startedAt: string;
    finishedAt: string | null;
    errorCode: string | null;
  } | null;
  recentProviderFailures: Array<{ providerCode: string; errorCode: string; count: number }>;
};

export type PortfolioTransactionCreateInput = {
  symbol: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fee?: number;
  currency?: "USD" | "VND";
  reportingCurrency?: "USD" | "VND";
  sourceSignalId?: string;
  executedAt?: string;
  note?: string | null;
  timeframe?: PortfolioTimeframe;
};

export type PortfolioTransactionUpdateInput = Omit<
  PortfolioTransactionCreateInput,
  "sourceSignalId"
>;

export type WatchlistMutationInput = {
  symbol?: string;
  providerCode?: string;
  providerSymbol?: string;
  requestedTimeframes?: Array<"1d">;
  alert?: number | null;
};

export type StrategyAssignmentCreateInput = {
  symbol: string;
  strategyCode: string;
  strategyVersion: string;
  strategyParameters: Record<string, unknown>;
  backtestRunId?: string;
  backtestRunLegId?: string;
};

export type StrategySignalResponse = {
  id: string;
  symbol: string;
  strategyCode: string;
  strategyVersion: string;
  signalType: "buy" | "sell";
  status: "suggested" | "reviewed" | "executed" | "dismissed";
  signalAt: string;
  executionAt: string | null;
  signalPrice: number | null;
  reason: string | null;
  metadata: Record<string, unknown>;
};

export type StrategyAssignmentResponse = {
  id: string;
  portfolioId: string;
  symbol: string;
  currency?: string;
  strategyCode: string;
  strategyVersion: string;
  strategyName: string;
  parameters: Record<string, unknown>;
  status: "active" | "paused";
  signals: StrategySignalResponse[];
};

export type StrategyForwardTestResponse = {
  assignmentId: string;
  portfolioId: string;
  symbol: string;
  currency?: string;
  strategy: { code: string; version: string; name: string; kind: string };
  status: "active" | "paused" | "evaluation_failed";
  activatedAt: string;
  lastEvaluatedAt: string | null;
  lastEvaluatedBarAt: string | null;
  latestSignal: StrategySignalResponse | null;
  backtestBaseline: { runId: string; legId: string; totalReturnPct: number } | null;
  snapshots: Array<{
    timestamp: string;
    equity: number;
    benchmarkEquity: number;
    pnlExcludingContributions: number;
    cumulativeContributions: number;
    cumulativeFees: number;
  }>;
};

export type NotificationResponse = {
  id: string;
  assignmentId: string;
  signalId: string;
  type: "strategy_buy" | "strategy_sell";
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export type ResearchRunImportInput = {
  source: string;
  kind: string;
  symbol?: string | null;
  status?: QuantRunStatus;
  summary?: string | null;
  parameters?: Record<string, unknown>;
  startedAt?: string | null;
  finishedAt?: string | null;
  insights?: Array<{
    source?: string;
    title: string;
    summary: string;
    sentiment: InvestorInsightInput["sentiment"];
    confidence?: number;
    catalyst?: string | null;
    risk?: string | null;
    publishedAt?: string;
  }>;
  evidence?: Array<{
    sourceType: string;
    sourceName: string;
    url?: string | null;
    title: string;
    excerpt: string;
    engagement?: number;
    observedAt?: string;
  }>;
  thesis?: {
    stance: InvestmentThesisInput["stance"];
    conviction: number;
    thesis: string;
    bullCase: string;
    bearCase: string;
    actionItems: string[];
  } | null;
  forecasts?: Array<{
    horizon: string;
    targetPrice: number;
    lowerBound: number;
    upperBound: number;
    confidence: number;
    model: string;
    generatedAt?: string;
  }>;
  providerRuns?: Array<{
    provider: string;
    status: QuantRunStatus;
    recordsFetched?: number;
    errorMessage?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }>;
};

export type PortfolioPositionInput = {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity: number;
  averageCost: number;
  latestPrice: number;
  currency?: string;
};

export type PortfolioTransactionInput = {
  id?: string;
  type: TransactionType;
  assetId: string;
  symbol?: string;
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
  note?: string | null;
  currency?: string;
};

export type PortfolioLedgerAsset = {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  latestPrice: number;
  currency?: string;
};

export type PortfolioLedgerTransaction = PortfolioTransactionInput & {
  id: string;
  createdAt: string;
};

export type PortfolioTransactionResponse = PortfolioLedgerTransaction & {
  grossAmount: number;
  netAmount: number;
  releasedCostBasis: number;
  realizedPnL: number;
  remainingQuantity: number;
  rawPrice?: number;
  rawFee?: number;
  rawCurrency?: "USD" | "VND";
  fxRateToVnd?: number;
  fxEffectiveDate?: string | null;
  fxSource?: string | null;
  fxFallback?: boolean;
};

export type PortfolioLedgerReplayResult = {
  positions: PortfolioPositionInput[];
  transactions: PortfolioTransactionResponse[];
  realizedPnL: number;
  cumulativeBuyCapital: number;
};

export type PortfolioPerformancePoint = {
  label: string;
  Portfolio: number;
  Benchmark: number;
  portfolioValue?: number;
  benchmarkValue?: number | null;
};

export type PortfolioBenchmarkSummary = {
  symbol: "VNINDEX";
  portfolioValue: number;
  benchmarkValue: number | null;
  excessValue: number | null;
  portfolioReturnPct: number;
  benchmarkReturnPct: number | null;
  excessReturnPct: number | null;
};

export type PortfolioHistoricalBar = {
  assetId: string;
  ts: string;
  close: number;
};

export type PortfolioHoldingResponse = {
  assetId: string;
  ticker: string;
  name: string;
  qty: number;
  price: number;
  cost: number;
  value: number;
  pnl: number;
  pnlPct: number;
  alloc: number;
  sentiment: "Bullish" | "Bearish" | "Neutral";
  category: "Crypto" | "Stocks" | "Cash";
  currency?: string;
};

export type PortfolioResponse = {
  portfolioId: string;
  portfolioName: string;
  baseCurrency: string;
  totalValue: number;
  totalCost: number;
  unrealizedPnL: number;
  realizedPnL: number;
  totalPnL: number;
  totalPnLPct: number;
  cumulativeBuyCapital: number;
  dayChangePct: number;
  allocation: { category: PortfolioHoldingResponse["category"]; value: number }[];
  holdings: PortfolioHoldingResponse[];
  transactions: PortfolioTransactionResponse[];
  performance: PortfolioPerformancePoint[];
  benchmark?: PortfolioBenchmarkSummary;
  riskMetrics: PortfolioRiskMetricResponse[];
  dataAsOf: string | null;
  dataSource: string;
};

export type PortfolioRiskMetricResponse = {
  key: "beta" | "sharpe" | "volatility" | "maxDrawdown" | "var95" | "diversification";
  label: string;
  value: string;
  rawValue: number;
  sub: string;
  tone: "primary" | "bull" | "bear";
};

export type MarketBarInput = {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  ts: string;
  close: number;
  volume: number | null;
};

export type MarketTickerResponse = {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  price: number;
  changePercent: number;
  volume: number | null;
  ts: string;
};

export type WatchlistItemResponse = {
  id: string;
  sym: string;
  name: string;
  price: number;
  chg: number;
  alert: number;
  sentiment: "bull" | "bear" | "neutral";
  datasetState: "ready" | "stale" | "loading" | "unavailable";
  ingestionRequestId: string | null;
  backtestableTimeframes: Array<"1d">;
  currency?: string;
  hasMarketQuote?: boolean;
};

export type QuantRunResponse = {
  id: string;
  strategyName: string;
  strategyCode: string | null;
  strategyVersion: string | null;
  status: QuantRunStatus;
  timeframe: "1d";
  progress: number;
  strategyHash: string | null;
  datasetVersionIds: string[];
  engineVersion: string;
  parameters: Record<string, unknown>;
  metrics: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  cacheHit: boolean;
  sourceRunId: string | null;
  legs: Array<{
    id: string;
    symbol: string;
    market: MarketDataMarket;
    currency: string;
    allocationBps: number;
    initialNotional: number;
    leverage: number;
    strategyCode: string;
    strategyVersion: string;
    strategyName: string;
    strategyParameters: Record<string, unknown>;
    implementationHash: string;
    datasetVersionId: string;
    status: QuantRunStatus;
    progress: number;
    metrics: Record<string, unknown> | null;
    errorCode: string | null;
  }>;
  artifacts: Array<{
    id: string;
    quantRunLegId: string | null;
    scopeKey: string;
    kind:
      | "equity"
      | "drawdown"
      | "trades"
      | "manifest"
      | "analytics"
      | "report_html"
      | "benchmark"
      | "contribution"
      | "cash_flow"
      | "rebalance"
      | "robustness";
    checksum: string;
    payload: unknown;
    rowCount: number;
    schemaVersion: number;
  }>;
};

export type InvestorInsightInput = {
  id: string;
  source: string;
  asset: string;
  sentiment: "bull" | "bear" | "neutral";
  title: string;
  summary: string;
  publishedAt: string;
  confidence: number;
  catalyst: string | null;
  risk: string | null;
};

export type InsightEvidenceInput = {
  id: string;
  insightId: string | null;
  sourceType: string;
  sourceName: string;
  url: string | null;
  title: string;
  excerpt: string;
  engagement: number;
  observedAt: string;
};

export type InvestmentThesisInput = {
  id: string;
  symbol: string;
  stance: "accumulate" | "hold" | "trim" | "avoid" | "watch";
  conviction: number;
  thesis: string;
  bullCase: string;
  bearCase: string;
  actionItems: string[];
  updatedAt: string;
};

export type ForecastPointInput = {
  horizon: string;
  targetPrice: number;
  lowerBound: number;
  upperBound: number;
  confidence: number;
  model: string;
  generatedAt: string;
};

export type AssetIntelligenceResponse = {
  symbol: string;
  name: string;
  latestPrice: number;
  score: number;
  stance: InvestmentThesisInput["stance"];
  summary: string;
  sentimentBreakdown: { bull: number; bear: number; neutral: number };
  topCatalysts: string[];
  topRisks: string[];
  evidenceCount: number;
  thesis: InvestmentThesisInput | null;
  forecasts: (ForecastPointInput & { expectedReturnPct: number })[];
  recentInsights: InvestorInsightInput[];
  evidence: InsightEvidenceInput[];
};

export type ResearchRunResponse = {
  id: string;
  source: string;
  kind: string;
  symbol: string | null;
  status: QuantRunStatus;
  summary: string | null;
  parameters: Record<string, unknown>;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};
