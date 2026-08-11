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

export type PortfolioTradeRow = BacktestResultModel["legs"][number]["trades"][number] & {
  legId: string;
  strategyCode: string;
};

export function buildPortfolioTradeRows(model: BacktestResultModel): PortfolioTradeRow[] {
  return model.legs
    .flatMap((leg) =>
      leg.trades.map((trade) => ({
        ...trade,
        legId: leg.id,
        strategyCode: leg.strategyCode,
      })),
    )
    .toSorted((left, right) => right.exitAt.localeCompare(left.exitAt));
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
