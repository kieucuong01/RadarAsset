export type AssetClass = "crypto" | "equity" | "etf" | "index" | "fx" | "commodity";

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  currency: string;
};

export type MarketBar = {
  assetId: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type QuantRunStatus = "queued" | "running" | "succeeded" | "failed";

export type QuantRun = {
  id: string;
  userId: string | null;
  strategyName: string;
  status: QuantRunStatus;
  parameters: Record<string, unknown>;
  metrics: Record<string, unknown> | null;
};
