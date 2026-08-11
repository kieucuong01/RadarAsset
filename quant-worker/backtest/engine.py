from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from .models import Bar
from .quality import normalize_bars
from .strategies import MovingAverageCrossoverStrategy, Strategy


ZERO = Decimal("0")
ONE = Decimal("1")
BPS = Decimal("10000")
OUTPUT_QUANTUM = Decimal("0.00000001")


@dataclass(frozen=True)
class EngineConfig:
    initial_capital: Decimal
    fast_period: int
    slow_period: int
    fee_bps: Decimal
    slippage_bps: Decimal
    leverage_by_asset: dict[str, Decimal]
    market_by_asset: dict[str, str]
    strategy_hash: str
    dataset_checksums: dict[str, str]
    strategy: Strategy | None = None
    sell_tax_bps: Decimal = ZERO
    financing_bps_annual: Decimal = ZERO


@dataclass(frozen=True)
class BacktestResult:
    summary: dict[str, float | int | None]
    equity: list[dict[str, Any]]
    drawdown: list[dict[str, Any]]
    trades: list[dict[str, Any]]
    manifest: dict[str, Any]


def _number(value: Decimal) -> float:
    return float(value.quantize(OUTPUT_QUANTUM, rounding=ROUND_HALF_UP))


def _timestamp(value: Bar) -> str:
    return value.timestamp.isoformat(timespec="seconds").replace("+00:00", "Z")


def artifact_checksum(payload: object) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _maximum_leverage(market: str) -> Decimal:
    if market == "vn_equity":
        return Decimal("2")
    if market in {"crypto_spot", "metal_spot"}:
        return Decimal("1")
    raise ValueError(f"Unsupported market: {market}.")


def _simulate_sleeve(
    asset: str,
    bars: list[Bar],
    *,
    sleeve_capital: Decimal,
    config: EngineConfig,
    strategy: Strategy,
) -> tuple[
    dict[str, dict[str, Decimal]],
    list[dict[str, Any]],
    Decimal,
    Decimal,
    Decimal,
]:
    rows = normalize_bars(bars)
    if len(rows) < strategy.warmup_bars + 2:
        raise ValueError(f"Insufficient bars for {asset}.")
    leverage = config.leverage_by_asset[asset]
    maximum = _maximum_leverage(config.market_by_asset[asset])
    if leverage < ONE or leverage > maximum:
        raise ValueError(f"{asset} leverage maximum is {maximum.normalize()}x.")

    fee_rate = config.fee_bps / BPS
    sell_tax_rate = config.sell_tax_bps / BPS
    slippage_rate = config.slippage_bps / BPS
    financing_rate = config.financing_bps_annual / BPS
    cash = sleeve_capital
    quantity = ZERO
    entry_price = ZERO
    entry_fee = ZERO
    entry_signal_at: str | None = None
    entry_at: str | None = None
    entry_index: int | None = None
    entry_reference_open = ZERO
    pending: tuple[str, str] | None = None
    total_fees = ZERO
    total_slippage = ZERO
    total_financing = ZERO
    borrowed_principal = ZERO
    previous_timestamp = None
    trades: list[dict[str, Any]] = []
    points: dict[str, dict[str, Decimal]] = {}
    prepare = getattr(strategy, "prepare", None)
    if callable(prepare):
        prepare(rows)
    for index, row in enumerate(rows):
        if previous_timestamp is not None and quantity > ZERO and borrowed_principal > ZERO:
            elapsed_days = Decimal(str((row.timestamp - previous_timestamp).total_seconds())) / Decimal(
                "86400"
            )
            financing_cost = borrowed_principal * financing_rate * elapsed_days / Decimal("365")
            cash -= financing_cost
            total_financing += financing_cost
        if pending is not None:
            action, signal_at = pending
            if action == "buy" and quantity == ZERO:
                fill_price = row.open * (ONE + slippage_rate)
                purchasing_power = sleeve_capital * leverage
                quantity = purchasing_power / (fill_price * (ONE + fee_rate))
                entry_fee = quantity * fill_price * fee_rate
                cash -= quantity * fill_price + entry_fee
                borrowed_principal = max(
                    ZERO, quantity * fill_price + entry_fee - sleeve_capital
                )
                entry_price = fill_price
                entry_signal_at = signal_at
                entry_at = _timestamp(row)
                entry_index = index
                entry_reference_open = row.open
                total_fees += entry_fee
                total_slippage += quantity * (fill_price - row.open)
            elif action == "sell" and quantity > ZERO:
                fill_price = row.open * (ONE - slippage_rate)
                exit_fee = quantity * fill_price * (fee_rate + sell_tax_rate)
                proceeds = quantity * fill_price - exit_fee
                cash += proceeds
                total_fees += exit_fee
                total_slippage += quantity * (row.open - fill_price)
                invested = quantity * entry_price + entry_fee
                realized_pnl = proceeds - invested
                bars_held = index - (entry_index if entry_index is not None else index)
                trades.append(
                    {
                        "asset": asset,
                        "side": "long",
                        "entrySignalAt": entry_signal_at,
                        "entryAt": entry_at,
                        "exitSignalAt": signal_at,
                        "exitAt": _timestamp(row),
                        "entryPrice": _number(entry_price),
                        "exitPrice": _number(fill_price),
                        "quantity": _number(quantity),
                        "fees": _number(entry_fee + exit_fee),
                        "slippageCost": _number(
                            quantity * (entry_price - entry_reference_open)
                            + quantity * (row.open - fill_price)
                        ),
                        "realizedPnl": _number(realized_pnl),
                        "returnPct": _number(realized_pnl / invested * Decimal("100")),
                        "barsHeld": bars_held,
                        "exitReason": "signal",
                    }
                )
                quantity = ZERO
                entry_price = ZERO
                entry_fee = ZERO
                entry_signal_at = None
                entry_at = None
                entry_index = None
                entry_reference_open = ZERO
                borrowed_principal = ZERO
            pending = None

        market_value = quantity * row.close
        points[_timestamp(row)] = {
            "cash": cash,
            "marketValue": market_value,
            "grossExposure": market_value,
            "equity": cash + market_value,
        }

        signal = strategy.signal(rows, index, in_position=quantity > ZERO)
        if signal is not None:
            pending = (signal.action, _timestamp(row))
        previous_timestamp = row.timestamp

    return points, trades, total_fees, total_slippage, total_financing


def run_strategy(
    bars_by_asset: dict[str, list[Bar]],
    config: EngineConfig,
    *,
    strategy: Strategy | None = None,
) -> BacktestResult:
    if config.initial_capital <= ZERO:
        raise ValueError("Initial capital must be positive.")
    selected_strategy = strategy or config.strategy
    if selected_strategy is None:
        raise ValueError("A strategy implementation is required.")
    assets = sorted(bars_by_asset)
    if not assets:
        raise ValueError("At least one asset is required.")
    if set(assets) != set(config.leverage_by_asset) or set(assets) != set(config.market_by_asset):
        raise ValueError("Engine configuration does not match the dataset assets.")

    sleeve_capital = config.initial_capital / Decimal(len(assets))
    sleeve_points: dict[str, dict[str, dict[str, Decimal]]] = {}
    trades: list[dict[str, Any]] = []
    total_fees = ZERO
    total_slippage = ZERO
    total_financing = ZERO
    for asset in assets:
        points, asset_trades, fees, slippage, financing = _simulate_sleeve(
            asset,
            bars_by_asset[asset],
            sleeve_capital=sleeve_capital,
            config=config,
            strategy=selected_strategy,
        )
        sleeve_points[asset] = points
        trades.extend(asset_trades)
        total_fees += fees
        total_slippage += slippage
        total_financing += financing

    timestamps = sorted({timestamp for points in sleeve_points.values() for timestamp in points})
    last_by_asset = {
        asset: {
            "cash": sleeve_capital,
            "marketValue": ZERO,
            "grossExposure": ZERO,
            "equity": sleeve_capital,
        }
        for asset in assets
    }
    peak = config.initial_capital
    maximum_drawdown = ZERO
    equity: list[dict[str, Any]] = []
    drawdown: list[dict[str, Any]] = []
    for timestamp in timestamps:
        for asset in assets:
            if timestamp in sleeve_points[asset]:
                last_by_asset[asset] = sleeve_points[asset][timestamp]
        cash = sum((point["cash"] for point in last_by_asset.values()), ZERO)
        market_value = sum((point["marketValue"] for point in last_by_asset.values()), ZERO)
        gross_exposure = sum((point["grossExposure"] for point in last_by_asset.values()), ZERO)
        total_equity = cash + market_value
        peak = max(peak, total_equity)
        current_drawdown = (total_equity / peak - ONE) * Decimal("100") if peak else ZERO
        maximum_drawdown = min(maximum_drawdown, current_drawdown)
        equity.append(
            {
                "timestamp": timestamp,
                "cash": _number(cash),
                "marketValue": _number(market_value),
                "grossExposure": _number(gross_exposure),
                "equity": _number(total_equity),
            }
        )
        drawdown.append({"timestamp": timestamp, "drawdownPct": _number(current_drawdown)})

    final_equity = Decimal(str(equity[-1]["equity"]))
    winners = [Decimal(str(trade["realizedPnl"])) for trade in trades if trade["realizedPnl"] > 0]
    losers = [Decimal(str(trade["realizedPnl"])) for trade in trades if trade["realizedPnl"] < 0]
    gross_profit = sum(winners, ZERO)
    gross_loss = abs(sum(losers, ZERO))
    summary: dict[str, float | int | None] = {
        "initialEquity": _number(config.initial_capital),
        "finalEquity": _number(final_equity),
        "totalReturnPct": _number((final_equity / config.initial_capital - ONE) * Decimal("100")),
        "maxDrawdownPct": _number(maximum_drawdown),
        "tradeCount": len(trades),
        "winRatePct": _number(Decimal(len(winners)) / Decimal(len(trades)) * Decimal("100"))
        if trades
        else 0.0,
        "profitFactor": _number(gross_profit / gross_loss) if gross_loss else None,
        "totalFees": _number(total_fees),
        "slippageCost": _number(total_slippage),
    }
    if total_financing > ZERO:
        summary["financingCost"] = _number(total_financing)
    trades.sort(key=lambda trade: (str(trade["exitAt"]), str(trade["asset"])))
    manifest = {
        "engineVersion": f"{selected_strategy.code}-v1",
        "strategyCode": selected_strategy.code,
        "strategyVersion": selected_strategy.version,
        "strategyHash": config.strategy_hash,
        "datasetChecksums": dict(sorted(config.dataset_checksums.items())),
        "assets": assets,
        "rules": {
            "signalTiming": "close-t",
            "executionTiming": "next-bar-open",
            "positionSide": "long-only",
            "slippageBps": _number(config.slippage_bps),
            "feeBps": _number(config.fee_bps),
            "sellTaxBps": _number(config.sell_tax_bps),
            "financingBpsAnnual": _number(config.financing_bps_annual),
        },
    }
    return BacktestResult(
        summary=summary,
        equity=equity,
        drawdown=drawdown,
        trades=trades,
        manifest=manifest,
    )


def run_ma_cross(bars_by_asset: dict[str, list[Bar]], config: EngineConfig) -> BacktestResult:
    if config.fast_period < 2 or config.fast_period >= config.slow_period:
        raise ValueError("MA periods are invalid.")
    return run_strategy(
        bars_by_asset,
        config,
        strategy=MovingAverageCrossoverStrategy(
            fast_period=config.fast_period,
            slow_period=config.slow_period,
        ),
    )
