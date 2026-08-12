from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from .custom_rules import PriceThresholdRule, ScheduledDcaRule
from .models import BacktestResult, Bar
from .quality import normalize_bars


ZERO = Decimal("0")
ONE = Decimal("1")
BPS = Decimal("10000")
Q = Decimal("0.00000001")


def _number(value: Decimal) -> float:
    return float(value.quantize(Q, rounding=ROUND_HALF_UP))


def _timestamp(bar: Bar) -> str:
    return bar.timestamp.isoformat(timespec="seconds").replace("+00:00", "Z")


def _result(
    *,
    asset: str,
    initial_capital: Decimal,
    equity: list[dict[str, Any]],
    trades: list[dict[str, Any]],
    fees: Decimal,
    slippage: Decimal,
    strategy_hash: str,
    dataset_checksum: str,
    strategy_kind: str,
    contributions: Decimal = ZERO,
) -> BacktestResult:
    peak = initial_capital
    maximum_drawdown = ZERO
    drawdown: list[dict[str, Any]] = []
    for point in equity:
        value = Decimal(str(point["equity"]))
        peak = max(peak, value)
        current = (value / peak - ONE) * Decimal("100") if peak else ZERO
        maximum_drawdown = min(maximum_drawdown, current)
        drawdown.append({"timestamp": point["timestamp"], "drawdownPct": _number(current)})
    final_equity = Decimal(str(equity[-1]["equity"]))
    profit = final_equity - initial_capital - contributions
    summary: dict[str, float | int | None] = {
        "initialEquity": _number(initial_capital),
        "finalEquity": _number(final_equity),
        "totalReturnPct": _number(profit / initial_capital * Decimal("100")),
        "maxDrawdownPct": _number(maximum_drawdown),
        "tradeCount": len(trades),
        "winRatePct": 0.0,
        "profitFactor": None,
        "totalFees": _number(fees),
        "slippageCost": _number(slippage),
    }
    if contributions:
        summary["cumulativeContributions"] = _number(contributions)
        summary["netProfitExcludingContributions"] = _number(profit)
        summary["timeWeightedReturnPct"] = _number(profit / initial_capital * Decimal("100"))
        summary["moneyWeightedReturnPct"] = None
    return BacktestResult(
        summary=summary,
        equity=equity,
        drawdown=drawdown,
        trades=trades,
        manifest={
            "engineVersion": "custom-rule-v1",
            "strategyCode": strategy_kind,
            "strategyVersion": "1.0.0",
            "strategyHash": strategy_hash,
            "datasetChecksums": {asset: dataset_checksum},
            "assets": [asset],
            "rules": {"signalTiming": "close-t", "executionTiming": "next-bar-open", "positionSide": "long-only"},
        },
    )


def run_price_threshold(
    asset: str,
    bars: list[Bar],
    *,
    initial_capital: Decimal,
    rule: PriceThresholdRule,
    fee_bps: Decimal,
    sell_tax_bps: Decimal,
    slippage_bps: Decimal,
    strategy_hash: str,
    dataset_checksum: str,
) -> BacktestResult:
    rows = normalize_bars(bars)
    if initial_capital <= ZERO or len(rows) < 2:
        raise ValueError("Custom backtest inputs are invalid.")
    fee_rate = fee_bps / BPS
    tax_rate = sell_tax_bps / BPS
    slip_rate = slippage_bps / BPS
    cash, quantity = initial_capital, ZERO
    fees, slippage = ZERO, ZERO
    trades: list[dict[str, Any]] = []
    equity: list[dict[str, Any]] = []
    pending: tuple[str, str] | None = None
    previous: Bar | None = None
    for row in rows:
        if pending is not None:
            action, signal_at = pending
            if action == "buy" and cash > ZERO:
                budget = cash * rule.size_pct / Decimal("100")
                fill = row.open * (ONE + slip_rate)
                qty = budget / (fill * (ONE + fee_rate))
                commission = qty * fill * fee_rate
                cash -= qty * fill + commission
                quantity += qty
                fees += commission
                slippage += qty * (fill - row.open)
                trades.append({"asset": asset, "action": "buy", "signalAt": signal_at, "executedAt": _timestamp(row), "referenceOpen": _number(row.open), "fillPrice": _number(fill), "quantity": _number(qty), "fees": _number(commission), "sizePct": _number(rule.size_pct), "reason": f"price_{rule.operator}"})
            elif action == "sell" and quantity > ZERO:
                qty = quantity * rule.size_pct / Decimal("100")
                fill = row.open * (ONE - slip_rate)
                commission = qty * fill * (fee_rate + tax_rate)
                cash += qty * fill - commission
                quantity -= qty
                fees += commission
                slippage += qty * (row.open - fill)
                trades.append({"asset": asset, "action": "sell", "signalAt": signal_at, "executedAt": _timestamp(row), "referenceOpen": _number(row.open), "fillPrice": _number(fill), "quantity": _number(qty), "fees": _number(commission), "sizePct": _number(rule.size_pct), "reason": f"price_{rule.operator}"})
            pending = None
        value = quantity * row.close
        equity.append({"timestamp": _timestamp(row), "cash": _number(cash), "marketValue": _number(value), "grossExposure": _number(value), "equity": _number(cash + value)})
        if previous is not None:
            crossed = previous.close <= rule.threshold < row.close if rule.operator == "crosses_above" else previous.close >= rule.threshold > row.close
            if crossed:
                pending = (rule.action, _timestamp(row))
        previous = row
    return _result(asset=asset, initial_capital=initial_capital, equity=equity, trades=trades, fees=fees, slippage=slippage, strategy_hash=strategy_hash, dataset_checksum=dataset_checksum, strategy_kind="price_threshold")


@dataclass(frozen=True)
class CustomBacktestResult:
    result: BacktestResult
    contributions: list[dict[str, Any]]
    cash_flow: list[dict[str, Any]]


def run_scheduled_dca(
    asset: str,
    bars: list[Bar],
    *,
    initial_capital: Decimal,
    rule: ScheduledDcaRule,
    fee_bps: Decimal,
    slippage_bps: Decimal,
    strategy_hash: str,
    dataset_checksum: str,
) -> CustomBacktestResult:
    rows = normalize_bars(bars)
    if initial_capital <= ZERO or not rows:
        raise ValueError("DCA backtest inputs are invalid.")
    fee_rate, slip_rate = fee_bps / BPS, slippage_bps / BPS
    cash, quantity = initial_capital, ZERO
    fees, slippage, contributed = ZERO, ZERO, ZERO
    paid_months: set[tuple[int, int]] = set()
    contributions: list[dict[str, Any]] = []
    trades: list[dict[str, Any]] = []
    equity: list[dict[str, Any]] = []
    for row in rows:
        month = (row.timestamp.year, row.timestamp.month)
        if month not in paid_months and row.timestamp.day >= rule.day_of_month:
            cash += rule.contribution_amount
            contributed += rule.contribution_amount
            fill = row.open * (ONE + slip_rate)
            qty = rule.contribution_amount / (fill * (ONE + fee_rate))
            commission = qty * fill * fee_rate
            invested = qty * fill + commission
            cash -= invested
            quantity += qty
            fees += commission
            slippage += qty * (fill - row.open)
            paid_months.add(month)
            item = {"scheduledDay": rule.day_of_month, "scheduledAt": f"{month[0]:04d}-{month[1]:02d}-{rule.day_of_month:02d}", "executedAt": _timestamp(row), "amount": _number(rule.contribution_amount), "currency": rule.currency, "investedAmount": _number(invested), "fees": _number(commission), "remainingCash": _number(cash), "source": "strategy_dca"}
            contributions.append(item)
            trades.append({"asset": asset, "action": "buy", "signalAt": _timestamp(row), "executedAt": _timestamp(row), "referenceOpen": _number(row.open), "fillPrice": _number(fill), "quantity": _number(qty), "fees": _number(commission), "sizePct": 100.0, "reason": "scheduled_dca"})
        value = quantity * row.close
        equity.append({"timestamp": _timestamp(row), "cash": _number(cash), "marketValue": _number(value), "grossExposure": _number(value), "equity": _number(cash + value)})
    result = _result(asset=asset, initial_capital=initial_capital, equity=equity, trades=trades, fees=fees, slippage=slippage, strategy_hash=strategy_hash, dataset_checksum=dataset_checksum, strategy_kind="scheduled_dca", contributions=contributed)
    flows = [{"timestamp": item["executedAt"], "type": "contribution", "amount": item["amount"], "source": "strategy_dca"} for item in contributions]
    return CustomBacktestResult(result=result, contributions=contributions, cash_flow=flows)
