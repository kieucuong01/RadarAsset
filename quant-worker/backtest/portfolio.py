from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from .models import BacktestResult


ZERO = Decimal("0")
ONE = Decimal("1")
BPS = Decimal("10000")
OUTPUT_QUANTUM = Decimal("0.00000001")
SUPPORTED_MARKETS = {"vn_equity", "crypto_spot", "metal_spot"}
SUPPORTED_REBALANCE = {"none", "monthly", "quarterly", "yearly"}


def _number(value: Decimal) -> float:
    return float(value.quantize(OUTPUT_QUANTUM, rounding=ROUND_HALF_UP))


def _decimal(value: object) -> Decimal:
    return Decimal(str(value))


def _timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass(frozen=True)
class PortfolioAssumptions:
    cash_allocation_bps: int
    rebalance_frequency: str
    monthly_contribution: Decimal
    dividend_mode: str
    fx_policy: str
    base_currency: str
    market_costs: dict[str, dict[str, Decimal]]


@dataclass(frozen=True)
class PortfolioLegInput:
    id: str
    symbol: str
    market: str
    allocation_bps: int
    initial_notional: Decimal
    dataset_checksum: str
    adjustment_policy: str
    result: BacktestResult


@dataclass(frozen=True)
class PortfolioLegResult:
    id: str
    symbol: str
    market: str
    result: BacktestResult


@dataclass(frozen=True)
class PortfolioBacktestResult:
    summary: dict[str, float | int | None]
    equity: list[dict[str, Any]]
    drawdown: list[dict[str, Any]]
    contribution: list[dict[str, Any]]
    cash_flow: list[dict[str, Any]]
    rebalance: list[dict[str, Any]]
    manifest: dict[str, Any]
    legs: list[PortfolioLegResult]


def _period_key(timestamp: str, frequency: str) -> tuple[int, ...]:
    value = _timestamp(timestamp)
    if frequency == "monthly":
        return (value.year, value.month)
    if frequency == "quarterly":
        return (value.year, (value.month - 1) // 3 + 1)
    if frequency == "yearly":
        return (value.year,)
    return ()


def _cost_rate(costs: dict[str, Decimal], *, is_buy: bool) -> Decimal:
    rate = costs["commissionBps"] + costs["slippageBps"]
    if not is_buy:
        rate += costs["sellTaxBps"]
    return rate / BPS


def _serialized_assumptions(assumptions: PortfolioAssumptions) -> dict[str, Any]:
    return {
        "cashAllocationBps": assumptions.cash_allocation_bps,
        "rebalanceFrequency": assumptions.rebalance_frequency,
        "monthlyContribution": _number(assumptions.monthly_contribution),
        "dividendMode": assumptions.dividend_mode,
        "fxPolicy": assumptions.fx_policy,
        "baseCurrency": assumptions.base_currency,
        "marketCosts": {
            market: {key: _number(value) for key, value in sorted(costs.items())}
            for market, costs in sorted(assumptions.market_costs.items())
        },
    }


def _validate(
    legs: list[PortfolioLegInput], total_capital: Decimal, assumptions: PortfolioAssumptions
) -> None:
    if total_capital <= ZERO:
        raise ValueError("Portfolio capital must be positive.")
    if not legs or len({leg.symbol for leg in legs}) != len(legs):
        raise ValueError("Portfolio legs must be non-empty and unique.")
    if sum(leg.allocation_bps for leg in legs) + assumptions.cash_allocation_bps != 10_000:
        raise ValueError("Portfolio allocation must total 10,000 basis points.")
    if assumptions.rebalance_frequency not in SUPPORTED_REBALANCE:
        raise ValueError("Unsupported rebalance frequency.")
    if assumptions.monthly_contribution < ZERO:
        raise ValueError("Monthly contribution cannot be negative.")
    if assumptions.fx_policy != "normalized_returns":
        raise ValueError("Unsupported FX policy.")
    if assumptions.dividend_mode not in {"exclude", "adjusted_prices"}:
        raise ValueError("Unsupported dividend mode.")
    if assumptions.dividend_mode == "adjusted_prices" and any(
        leg.adjustment_policy != "total_return" for leg in legs
    ):
        raise ValueError("Adjusted dividend mode requires adjusted datasets.")
    for leg in legs:
        if leg.market not in SUPPORTED_MARKETS or leg.market not in assumptions.market_costs:
            raise ValueError(f"Unsupported market for {leg.symbol}.")
        if not leg.result.equity:
            raise ValueError(f"Completed sleeve values are unavailable for {leg.symbol}.")
        if _decimal(leg.result.equity[0]["equity"]) <= ZERO:
            raise ValueError(f"Initial sleeve equity is invalid for {leg.symbol}.")
        if leg.initial_notional != total_capital * Decimal(leg.allocation_bps) / BPS:
            raise ValueError(f"Initial notional does not match allocation for {leg.symbol}.")
        costs = assumptions.market_costs[leg.market]
        if set(costs) != {
            "commissionBps",
            "sellTaxBps",
            "slippageBps",
            "financingBpsAnnual",
        } or any(value < ZERO for value in costs.values()):
            raise ValueError(f"Market costs are invalid for {leg.market}.")


def run_portfolio(
    legs: list[PortfolioLegInput],
    *,
    total_capital: Decimal,
    assumptions: PortfolioAssumptions,
    portfolio_hash: str,
) -> PortfolioBacktestResult:
    """Aggregate causal, completed per-leg valuations into normalized portfolio accounting."""

    ordered_legs = sorted(legs, key=lambda item: item.symbol)
    _validate(ordered_legs, total_capital, assumptions)
    points_by_symbol = {
        leg.symbol: {str(point["timestamp"]): point for point in leg.result.equity}
        for leg in ordered_legs
    }
    timestamps = sorted(
        {timestamp for points in points_by_symbol.values() for timestamp in points},
        key=_timestamp,
    )
    balances = {leg.symbol: leg.initial_notional for leg in ordered_legs}
    cash = total_capital * Decimal(assumptions.cash_allocation_bps) / BPS
    previous_sleeve_equity: dict[str, Decimal] = {}
    last_month: tuple[int, ...] | None = None
    last_rebalance_period: tuple[int, ...] | None = None
    peak = total_capital
    maximum_drawdown = ZERO
    total_contributions = ZERO
    total_rebalance_cost = ZERO
    equity: list[dict[str, Any]] = []
    drawdown: list[dict[str, Any]] = []
    contribution: list[dict[str, Any]] = []
    cash_flow: list[dict[str, Any]] = []
    rebalance: list[dict[str, Any]] = []

    for timestamp in timestamps:
        for leg in ordered_legs:
            point = points_by_symbol[leg.symbol].get(timestamp)
            if point is None:
                continue
            sleeve_equity = _decimal(point["equity"])
            previous = previous_sleeve_equity.get(leg.symbol)
            if previous is not None:
                if previous <= ZERO:
                    raise ValueError(f"Sleeve equity became non-positive for {leg.symbol}.")
                balances[leg.symbol] *= sleeve_equity / previous
            previous_sleeve_equity[leg.symbol] = sleeve_equity

        month = _period_key(timestamp, "monthly")
        if last_month is not None and month != last_month and assumptions.monthly_contribution > ZERO:
            amount = assumptions.monthly_contribution
            total_contributions += amount
            for leg in ordered_legs:
                balances[leg.symbol] += amount * Decimal(leg.allocation_bps) / BPS
            cash_amount = amount * Decimal(assumptions.cash_allocation_bps) / BPS
            cash += cash_amount
            cash_flow.append(
                {
                    "timestamp": timestamp,
                    "type": "contribution",
                    "amount": _number(amount),
                    "cashAmount": _number(cash_amount),
                }
            )
        last_month = month

        frequency = assumptions.rebalance_frequency
        period = _period_key(timestamp, frequency)
        should_rebalance = (
            frequency != "none"
            and last_rebalance_period is not None
            and period != last_rebalance_period
        )
        if should_rebalance:
            value_before = cash + sum(balances.values(), ZERO)
            transfers: dict[str, float] = {}
            turnover = ZERO
            cost = ZERO
            new_balances: dict[str, Decimal] = {}
            for leg in ordered_legs:
                target = value_before * Decimal(leg.allocation_bps) / BPS
                transfer = target - balances[leg.symbol]
                leg_cost = abs(transfer) * _cost_rate(
                    assumptions.market_costs[leg.market], is_buy=transfer >= ZERO
                )
                new_balances[leg.symbol] = max(ZERO, target - leg_cost)
                turnover += abs(transfer)
                cost += leg_cost
                transfers[leg.symbol] = _number(transfer)
            balances = new_balances
            cash = value_before * Decimal(assumptions.cash_allocation_bps) / BPS
            total_rebalance_cost += cost
            rebalance.append(
                {
                    "timestamp": timestamp,
                    "frequency": frequency,
                    "turnover": _number(turnover),
                    "cost": _number(cost),
                    "transfers": transfers,
                }
            )
        if frequency != "none":
            last_rebalance_period = period

        market_value = sum(balances.values(), ZERO)
        total_equity = cash + market_value
        peak = max(peak, total_equity)
        current_drawdown = (total_equity / peak - ONE) * Decimal("100") if peak else ZERO
        maximum_drawdown = min(maximum_drawdown, current_drawdown)
        components = {leg.symbol: _number(balances[leg.symbol]) for leg in ordered_legs}
        components["cash"] = _number(cash)
        equity.append(
            {
                "timestamp": timestamp,
                "cash": _number(cash),
                "marketValue": _number(market_value),
                "grossExposure": _number(market_value),
                "equity": _number(total_equity),
            }
        )
        drawdown.append({"timestamp": timestamp, "drawdownPct": _number(current_drawdown)})
        contribution.append(
            {"timestamp": timestamp, "equity": _number(total_equity), "components": components}
        )

    final_equity = _decimal(equity[-1]["equity"])
    net_profit = final_equity - total_capital - total_contributions
    summary: dict[str, float | int | None] = {
        "initialEquity": _number(total_capital),
        "finalEquity": _number(final_equity),
        "netContributions": _number(total_contributions),
        "totalReturnPct": _number(net_profit / total_capital * Decimal("100")),
        "maxDrawdownPct": _number(maximum_drawdown),
        "tradeCount": sum(len(leg.result.trades) for leg in ordered_legs),
        "totalFees": _number(
            sum((_decimal(leg.result.summary.get("totalFees", 0)) for leg in ordered_legs), ZERO)
            + total_rebalance_cost
        ),
        "rebalanceCost": _number(total_rebalance_cost),
    }
    manifest = {
        "engineVersion": "portfolio-v1",
        "portfolioHash": portfolio_hash,
        "datasetChecksums": {
            leg.symbol: leg.dataset_checksum for leg in ordered_legs
        },
        "assets": [leg.symbol for leg in ordered_legs],
        "assumptions": _serialized_assumptions(assumptions),
        "rules": {
            "valuation": "completed-sleeve-values-only",
            "contributionTiming": "first-completed-timestamp-of-new-month-before-rebalance",
            "rebalanceCostBasis": "absolute-transferred-asset-notional",
            "cashInterest": 0,
            "fx": "normalized-returns-no-fabricated-rates",
        },
    }
    return PortfolioBacktestResult(
        summary=summary,
        equity=equity,
        drawdown=drawdown,
        contribution=contribution,
        cash_flow=cash_flow,
        rebalance=rebalance,
        manifest=manifest,
        legs=[
            PortfolioLegResult(id=leg.id, symbol=leg.symbol, market=leg.market, result=leg.result)
            for leg in ordered_legs
        ],
    )
