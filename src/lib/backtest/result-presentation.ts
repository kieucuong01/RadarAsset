import type { BacktestRun } from "./client";
import type { BacktestResultModel } from "./result-model";

export function alignEquityAndDrawdown(
  equity: BacktestResultModel["aggregate"]["equity"],
  drawdown: BacktestResultModel["aggregate"]["drawdown"],
) {
  const drawdownByTimestamp = new Map(
    drawdown.map((point) => [point.timestamp, point.drawdownPct]),
  );

  return equity.map((point) => ({
    timestamp: point.timestamp,
    equity: point.equity,
    drawdownPct: drawdownByTimestamp.get(point.timestamp) ?? null,
  }));
}

export type PortfolioTradeRow = {
  legId: string;
  strategyCode: string;
  asset: string;
  action: "long" | "buy" | "sell";
  signalAt: string;
  executedAt: string;
  price: number;
  quantity: number;
  fees: number;
  realizedPnl: number | null;
  returnPct: number | null;
  barsHeld: number | null;
  reason: string;
};

export function buildPortfolioTradeRows(model: BacktestResultModel): PortfolioTradeRow[] {
  return model.legs
    .flatMap((leg) =>
      leg.trades.map(
        (trade): PortfolioTradeRow =>
          "action" in trade
            ? {
                legId: leg.id,
                strategyCode: leg.strategyCode,
                asset: trade.asset,
                action: trade.action,
                signalAt: trade.signalAt,
                executedAt: trade.executedAt,
                price: trade.fillPrice,
                quantity: trade.quantity,
                fees: trade.fees,
                realizedPnl: null,
                returnPct: null,
                barsHeld: null,
                reason: trade.reason,
              }
            : {
                legId: leg.id,
                strategyCode: leg.strategyCode,
                asset: trade.asset,
                action: "long",
                signalAt: trade.entrySignalAt,
                executedAt: trade.exitAt,
                price: trade.exitPrice,
                quantity: trade.quantity,
                fees: trade.fees,
                realizedPnl: trade.realizedPnl,
                returnPct: trade.returnPct,
                barsHeld: trade.barsHeld,
                reason: trade.exitReason,
              },
      ),
    )
    .sort((left, right) => right.executedAt.localeCompare(left.executedAt));
}

export function filterPortfolioTradeRows(rows: PortfolioTradeRow[], symbol: string) {
  return symbol === "all" ? rows : rows.filter((trade) => trade.asset === symbol);
}

function finiteMetric(metrics: Record<string, unknown>, key: string) {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildBacktestKpis(model: BacktestResultModel) {
  return {
    totalReturnPct: finiteMetric(model.aggregate.metrics, "totalReturnPct"),
    maxDrawdownPct: finiteMetric(model.aggregate.metrics, "maxDrawdownPct"),
    sharpe: finiteMetric(model.aggregate.metrics, "sharpe"),
    winRatePct: finiteMetric(model.aggregate.metrics, "winRatePct"),
    profitFactor: finiteMetric(model.aggregate.metrics, "profitFactor"),
  };
}

export function advancedAnalysisAvailability(model: BacktestResultModel) {
  return {
    quantStats: model.aggregate.analytics !== null || model.aggregate.reportHtml !== null,
    contribution: model.aggregate.contribution.length > 0,
    cashFlowOrRebalance:
      model.aggregate.cashFlow.length > 0 || model.aggregate.rebalance.length > 0,
    perLeg: model.legs.length > 0,
  };
}

export function backtestOutputState(status: BacktestRun["status"] | null) {
  if (status === null) return "empty" as const;
  if (status === "queued" || status === "running") return "active" as const;
  if (status === "failed") return "failed" as const;
  return "results" as const;
}
