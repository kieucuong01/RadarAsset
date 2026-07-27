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
  totalPnL: number;
  totalPnLPct: number;
  dayChangePct: number;
  allocation: { category: PortfolioHoldingResponse["category"]; value: number }[];
  holdings: PortfolioHoldingResponse[];
  transactions: PortfolioTransactionInput[];
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

export type QuantRunResponse = {
  id: string;
  strategyName: string;
  status: QuantRunStatus;
  parameters: Record<string, unknown>;
  metrics: Record<string, unknown> | null;
  errorMessage: string | null;
};
