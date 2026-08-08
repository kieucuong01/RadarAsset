export type AssetClass = "crypto" | "equity" | "etf" | "index" | "fx" | "commodity" | "cash";

export type TransactionType = "buy" | "sell";

export type QuantRunStatus = "queued" | "running" | "succeeded" | "failed";

export type PortfolioPositionInput = {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity: number;
  averageCost: number;
  latestPrice: number;
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
};

export type PortfolioLedgerAsset = {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  latestPrice: number;
};

export type PortfolioLedgerTransaction = PortfolioTransactionInput & {
  id: string;
  createdAt: string;
};

export type PortfolioTransactionResponse = PortfolioTransactionInput & {
  createdAt?: string;
  grossAmount?: number;
  netAmount?: number;
  releasedCostBasis?: number;
  realizedPnL?: number;
  remainingQuantity?: number;
};

export type PortfolioLedgerReplayResult = {
  positions: PortfolioPositionInput[];
  transactions: (PortfolioTransactionResponse & { id: string; createdAt: string })[];
  realizedPnL: number;
  cumulativeBuyCapital: number;
};

export type PortfolioPerformancePoint = {
  label: string;
  Portfolio: number;
  Benchmark: number;
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
};

export type QuantRunResponse = {
  id: string;
  strategyName: string;
  status: QuantRunStatus;
  parameters: Record<string, unknown>;
  metrics: Record<string, unknown> | null;
  errorMessage: string | null;
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
