import type {
  PortfolioHoldingResponse,
  PortfolioHistoricalBar,
  PortfolioLedgerAsset,
  PortfolioLedgerReplayResult,
  PortfolioLedgerTransaction,
  PortfolioPerformancePoint,
  PortfolioPositionInput,
  PortfolioResponse,
  PortfolioRiskMetricResponse,
  PortfolioTransactionInput,
  PortfolioTransactionResponse,
} from "./types";

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function categoryFor(
  assetClass: PortfolioPositionInput["assetClass"],
): PortfolioHoldingResponse["category"] {
  if (assetClass === "crypto") return "Crypto";
  if (assetClass === "cash") return "Cash";
  return "Stocks";
}

function sentimentFor(pnlPct: number): PortfolioHoldingResponse["sentiment"] {
  if (pnlPct > 3) return "Bullish";
  if (pnlPct < -3) return "Bearish";
  return "Neutral";
}

export function buildPortfolioResponse(input: {
  portfolioId: string;
  portfolioName: string;
  baseCurrency: string;
  positions: PortfolioPositionInput[];
  transactions: PortfolioTransactionResponse[];
  performance: PortfolioPerformancePoint[];
  realizedPnL?: number;
  cumulativeBuyCapital?: number;
  dataAsOf?: string | null;
  dataSource?: string;
}): PortfolioResponse {
  const totalValue = input.positions.reduce((sum, position) => {
    return sum + position.quantity * position.latestPrice;
  }, 0);
  const totalCost = input.positions.reduce((sum, position) => {
    return sum + position.quantity * position.averageCost;
  }, 0);
  const unrealizedPnL = totalValue - totalCost;
  const realizedPnL = input.realizedPnL ?? 0;
  const totalPnL = unrealizedPnL + realizedPnL;
  const cumulativeBuyCapital = input.cumulativeBuyCapital ?? totalCost;
  const totalPnLPct = cumulativeBuyCapital === 0 ? 0 : (totalPnL / cumulativeBuyCapital) * 100;

  const holdings = input.positions.map((position) => {
    const value = position.quantity * position.latestPrice;
    const costBasis = position.quantity * position.averageCost;
    const pnl = value - costBasis;
    const pnlPct = costBasis === 0 ? 0 : (pnl / costBasis) * 100;

    return {
      assetId: position.assetId,
      ticker: position.symbol,
      name: position.name,
      qty: position.quantity,
      price: position.latestPrice,
      cost: position.averageCost,
      value: round(value),
      pnl: round(pnl),
      pnlPct: round(pnlPct, 4),
      alloc: totalValue === 0 ? 0 : round((value / totalValue) * 100),
      sentiment: sentimentFor(pnlPct),
      category: categoryFor(position.assetClass),
    };
  });

  const allocationMap = new Map<PortfolioHoldingResponse["category"], number>();
  for (const holding of holdings) {
    allocationMap.set(holding.category, (allocationMap.get(holding.category) ?? 0) + holding.value);
  }

  const allocation = Array.from(allocationMap.entries()).map(([category, value]) => ({
    category,
    value: totalValue === 0 ? 0 : round((value / totalValue) * 100),
  }));
  const previousPerformance = input.performance[input.performance.length - 2]?.Portfolio ?? null;
  const latestPerformance = input.performance[input.performance.length - 1]?.Portfolio ?? null;
  const dayChangePct =
    previousPerformance && latestPerformance
      ? ((latestPerformance - previousPerformance) / previousPerformance) * 100
      : 0;

  return {
    portfolioId: input.portfolioId,
    portfolioName: input.portfolioName,
    baseCurrency: input.baseCurrency,
    totalValue: round(totalValue),
    totalCost: round(totalCost),
    unrealizedPnL: round(unrealizedPnL),
    realizedPnL: round(realizedPnL),
    totalPnL: round(totalPnL),
    totalPnLPct: round(totalPnLPct, 4),
    cumulativeBuyCapital: round(cumulativeBuyCapital),
    dayChangePct: round(dayChangePct, 4),
    allocation,
    holdings,
    transactions: input.transactions,
    performance: input.performance,
    riskMetrics: calculateRiskMetrics({
      totalValue: round(totalValue),
      allocation,
      performance: input.performance,
    }),
    dataAsOf: input.dataAsOf ?? null,
    dataSource: input.dataSource ?? "local",
  };
}

export class PortfolioDomainError extends Error {
  constructor(
    message: string,
    readonly code: "POSITION_NOT_FOUND" | "INSUFFICIENT_QUANTITY",
  ) {
    super(message);
    this.name = "PortfolioDomainError";
  }
}

function compareLedgerTransactions(
  left: PortfolioLedgerTransaction,
  right: PortfolioLedgerTransaction,
) {
  return (
    left.executedAt.localeCompare(right.executedAt) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

export function replayPortfolioLedger(input: {
  assets: PortfolioLedgerAsset[];
  transactions: PortfolioLedgerTransaction[];
}): PortfolioLedgerReplayResult {
  const assets = new Map(input.assets.map((asset) => [asset.assetId, asset]));
  const positions = new Map<string, PortfolioPositionInput>();
  const transactions: PortfolioLedgerReplayResult["transactions"] = [];
  let realizedPnL = 0;
  let cumulativeBuyCapital = 0;

  for (const transaction of [...input.transactions].sort(compareLedgerTransactions)) {
    const asset = assets.get(transaction.assetId);
    if (!asset) {
      throw new Error(`Asset metadata not found for ${transaction.assetId}.`);
    }

    const current = positions.get(transaction.assetId) ?? null;
    if (transaction.type === "sell" && !current) {
      throw new PortfolioDomainError(
        `Cannot sell ${asset.symbol} because no position is available at this transaction time.`,
        "POSITION_NOT_FOUND",
      );
    }
    if (transaction.type === "sell" && current && transaction.quantity > current.quantity) {
      throw new PortfolioDomainError(
        `Cannot sell ${transaction.quantity} ${asset.symbol}; only ${current.quantity} is available at this transaction time.`,
        "INSUFFICIENT_QUANTITY",
      );
    }

    const grossAmount = transaction.quantity * transaction.price;
    const releasedCostBasis =
      transaction.type === "sell" && current ? transaction.quantity * current.averageCost : 0;
    const netAmount =
      transaction.type === "buy" ? -(grossAmount + transaction.fee) : grossAmount - transaction.fee;
    const transactionRealizedPnL = transaction.type === "sell" ? netAmount - releasedCostBasis : 0;

    const next = applyPortfolioTransaction(current, transaction);
    const enrichedNext: PortfolioPositionInput = {
      ...next,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: asset.assetClass,
      latestPrice: asset.latestPrice,
    };

    if (enrichedNext.quantity <= 0) {
      positions.delete(transaction.assetId);
    } else {
      positions.set(transaction.assetId, enrichedNext);
    }

    if (transaction.type === "buy") {
      cumulativeBuyCapital += grossAmount + transaction.fee;
    }
    realizedPnL += transactionRealizedPnL;

    transactions.push({
      ...transaction,
      grossAmount: round(grossAmount, 8),
      netAmount: round(netAmount, 8),
      releasedCostBasis: round(releasedCostBasis, 8),
      realizedPnL: round(transactionRealizedPnL, 8),
      remainingQuantity: round(enrichedNext.quantity, 8),
    });
  }

  return {
    positions: Array.from(positions.values()),
    transactions,
    realizedPnL: round(realizedPnL, 8),
    cumulativeBuyCapital: round(cumulativeBuyCapital, 8),
  };
}

function dateKey(iso: string) {
  return iso.slice(0, 10);
}

function performanceLabel(key: string) {
  return new Date(`${key}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function buildTradeAwarePerformance(input: {
  assets: PortfolioLedgerAsset[];
  transactions: PortfolioLedgerTransaction[];
  bars: PortfolioHistoricalBar[];
  benchmarkAssetId: string | null;
  limit: number;
}): PortfolioPerformancePoint[] {
  if (input.limit <= 0) return [];

  const assets = new Map(input.assets.map((asset) => [asset.assetId, asset]));
  const portfolioAssetIds = new Set(input.transactions.map((transaction) => transaction.assetId));
  const barsByDate = new Map<string, PortfolioHistoricalBar[]>();
  for (const bar of input.bars) {
    const key = dateKey(bar.ts);
    const dayBars = barsByDate.get(key) ?? [];
    dayBars.push(bar);
    barsByDate.set(key, dayBars);
  }

  const dates = Array.from(barsByDate.keys())
    .filter((key) => barsByDate.get(key)?.some((bar) => portfolioAssetIds.has(bar.assetId)))
    .sort();
  if (!dates.length) return [];

  const transactions = [...input.transactions].sort(compareLedgerTransactions);
  const positions = new Map<string, PortfolioPositionInput>();
  const latestPrices = new Map<string, number>();
  const points: PortfolioPerformancePoint[] = [];
  let transactionIndex = 0;
  let previousValue: number | null = null;
  let portfolioIndex = 100;
  let benchmarkBase: number | null = null;
  let pendingExternalFlow = 0;

  for (const key of dates) {
    for (const bar of barsByDate.get(key) ?? []) {
      latestPrices.set(bar.assetId, bar.close);
    }

    while (
      transactionIndex < transactions.length &&
      dateKey(transactions[transactionIndex].executedAt) <= key
    ) {
      const transaction = transactions[transactionIndex];
      const asset = assets.get(transaction.assetId);
      if (!asset) throw new Error(`Asset metadata not found for ${transaction.assetId}.`);

      const current = positions.get(transaction.assetId) ?? null;
      const next = applyPortfolioTransaction(current, transaction);
      if (next.quantity <= 0) {
        positions.delete(transaction.assetId);
      } else {
        positions.set(transaction.assetId, {
          ...next,
          symbol: asset.symbol,
          name: asset.name,
          assetClass: asset.assetClass,
          latestPrice: asset.latestPrice,
        });
      }

      const gross = transaction.quantity * transaction.price;
      pendingExternalFlow +=
        transaction.type === "buy" ? gross + transaction.fee : -(gross - transaction.fee);
      transactionIndex += 1;
    }

    const missingPrice = Array.from(positions.keys()).some((assetId) => !latestPrices.has(assetId));
    if (missingPrice) continue;

    const currentValue = Array.from(positions.values()).reduce(
      (sum, position) => sum + position.quantity * (latestPrices.get(position.assetId) ?? 0),
      0,
    );
    if (positions.size && currentValue <= 0) continue;
    if (!positions.size && (previousValue === null || pendingExternalFlow === 0)) continue;

    const benchmarkPrice = input.benchmarkAssetId
      ? (latestPrices.get(input.benchmarkAssetId) ?? null)
      : null;
    if (benchmarkBase === null && benchmarkPrice !== null) {
      benchmarkBase = benchmarkPrice;
    }
    if (previousValue === null) {
      previousValue = currentValue;
    } else if (previousValue > 0) {
      portfolioIndex *= (currentValue - pendingExternalFlow) / previousValue;
      previousValue = currentValue;
    } else if (currentValue > 0) {
      previousValue = currentValue;
    }
    pendingExternalFlow = 0;

    const benchmarkIndex =
      benchmarkPrice !== null && benchmarkBase ? (benchmarkPrice / benchmarkBase) * 100 : 100;
    points.push({
      label: performanceLabel(key),
      Portfolio: round(portfolioIndex, 2),
      Benchmark: round(benchmarkIndex, 2),
    });
  }

  const visible = points.slice(-input.limit);
  const portfolioBase = visible[0]?.Portfolio ?? 100;
  const benchmarkVisibleBase = visible[0]?.Benchmark ?? 100;
  return visible.map((point) => ({
    label: point.label,
    Portfolio: round((point.Portfolio / portfolioBase) * 100, 2),
    Benchmark: round((point.Benchmark / benchmarkVisibleBase) * 100, 2),
  }));
}

export function applyPortfolioTransaction(
  current: PortfolioPositionInput | null,
  transaction: PortfolioTransactionInput,
): PortfolioPositionInput {
  if (!current && transaction.type === "sell") {
    throw new Error("Cannot sell an asset that is not in the portfolio.");
  }

  if (!current) {
    const totalCost = transaction.quantity * transaction.price + transaction.fee;
    return {
      assetId: transaction.assetId,
      symbol: "",
      name: "",
      assetClass: "equity",
      quantity: transaction.quantity,
      averageCost: transaction.quantity === 0 ? 0 : totalCost / transaction.quantity,
      latestPrice: transaction.price,
    };
  }

  if (transaction.type === "buy") {
    const nextQuantity = current.quantity + transaction.quantity;
    const nextCost =
      current.quantity * current.averageCost +
      transaction.quantity * transaction.price +
      transaction.fee;

    return {
      ...current,
      quantity: round(nextQuantity, 8),
      averageCost: nextQuantity === 0 ? 0 : nextCost / nextQuantity,
    };
  }

  if (transaction.quantity > current.quantity) {
    throw new Error("Cannot sell more than the current position quantity.");
  }

  const nextQuantity = current.quantity - transaction.quantity;

  return {
    ...current,
    quantity: round(nextQuantity, 8),
    averageCost: nextQuantity === 0 ? 0 : current.averageCost,
  };
}

function returns(values: number[]) {
  const out: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    if (previous !== 0) out.push(values[index] / previous - 1);
  }
  return out;
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdev(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function covariance(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const left = a.slice(0, n);
  const right = b.slice(0, n);
  const avgLeft = mean(left);
  const avgRight = mean(right);
  return (
    left.reduce((sum, value, index) => sum + (value - avgLeft) * (right[index] - avgRight), 0) /
    (n - 1)
  );
}

function maxDrawdown(values: number[]) {
  let peak = values[0] ?? 0;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function diversificationGrade(hhi: number) {
  if (hhi <= 0.22) return "A";
  if (hhi <= 0.35) return "B";
  if (hhi <= 0.5) return "C";
  if (hhi <= 0.7) return "D";
  return "F";
}

export function calculateRiskMetrics(input: {
  totalValue: number;
  allocation: { category: PortfolioHoldingResponse["category"]; value: number }[];
  performance: PortfolioPerformancePoint[];
}): PortfolioRiskMetricResponse[] {
  const portfolioValues = input.performance.map((point) => point.Portfolio);
  const benchmarkValues = input.performance.map((point) => point.Benchmark);
  const portfolioReturns = returns(portfolioValues);
  const benchmarkReturns = returns(benchmarkValues);
  const annualVol = sampleStdev(portfolioReturns) * Math.sqrt(252);
  const annualReturn = mean(portfolioReturns) * 252;
  const riskFree = 0.04;
  const sharpe = annualVol === 0 ? 0 : (annualReturn - riskFree) / annualVol;
  const benchmarkVariance = sampleStdev(benchmarkReturns) ** 2;
  const beta =
    benchmarkVariance === 0
      ? 0
      : covariance(portfolioReturns, benchmarkReturns) / benchmarkVariance;
  const drawdown = maxDrawdown(portfolioValues);
  const var95Return = percentile(portfolioReturns, 0.05);
  const var95 = input.totalValue * var95Return;
  const hhi = input.allocation.reduce((sum, item) => sum + (item.value / 100) ** 2, 0);
  const grade = diversificationGrade(hhi);

  return [
    {
      key: "beta",
      label: "Beta (vs SPY)",
      value: beta.toFixed(2),
      rawValue: round(beta, 4),
      sub: beta > 1.1 ? "Slightly aggressive" : beta < 0.8 ? "Defensive tilt" : "Market-like",
      tone: beta > 1.2 ? "bear" : "primary",
    },
    {
      key: "sharpe",
      label: "Sharpe Ratio",
      value: sharpe.toFixed(2),
      rawValue: round(sharpe, 4),
      sub: "Rf = 4.0%",
      tone: sharpe >= 1 ? "bull" : sharpe < 0 ? "bear" : "primary",
    },
    {
      key: "volatility",
      label: "Volatility (ann.)",
      value: `${(annualVol * 100).toFixed(1)}%`,
      rawValue: round(annualVol * 100, 4),
      sub: `${Math.max(input.performance.length - 1, 0)} daily returns`,
      tone: annualVol > 0.35 ? "bear" : "primary",
    },
    {
      key: "maxDrawdown",
      label: "Max Drawdown",
      value: `${(drawdown * 100).toFixed(1)}%`,
      rawValue: round(drawdown * 100, 4),
      sub: "Peak-to-trough",
      tone: drawdown < -0.15 ? "bear" : "primary",
    },
    {
      key: "var95",
      label: "VaR 95% (1D)",
      value: var95.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }),
      rawValue: round(var95, 2),
      sub: "Historical method",
      tone: "bear",
    },
    {
      key: "diversification",
      label: "Diversification",
      value: grade,
      rawValue: round(hhi, 4),
      sub: `HHI ${hhi.toFixed(2)}`,
      tone: grade === "A" || grade === "B" ? "bull" : grade === "F" ? "bear" : "primary",
    },
  ];
}
