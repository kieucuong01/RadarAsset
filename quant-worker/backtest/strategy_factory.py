from __future__ import annotations

from decimal import Decimal
from typing import Any

from .strategies import (
    AbcdCausalStrategy,
    AtrBreakoutStrategy,
    BollingerMeanReversionStrategy,
    EmaTrendStrategy,
    MacdMomentumStrategy,
    MovingAverageCrossoverStrategy,
    RsiMeanReversionStrategy,
    SignalRollingReversalStrategy,
    Strategy,
    TurtleBreakoutStrategy,
)


def _integer(parameters: dict[str, Any], name: str, minimum: int, maximum: int) -> int:
    value = parameters.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{name} is invalid.")
    return value


def _decimal(parameters: dict[str, Any], name: str, minimum: str, maximum: str) -> Decimal:
    value = parameters.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} is invalid.")
    result = Decimal(str(value))
    if not Decimal(minimum) <= result <= Decimal(maximum):
        raise ValueError(f"{name} is invalid.")
    return result


def strategy_from_catalog(code: str, version: str, parameters: dict[str, Any]) -> Strategy:
    if version != "1.0.0":
        raise ValueError("Unsupported strategy version.")
    if code == "ma_crossover" and set(parameters) == {"fastPeriod", "slowPeriod"}:
        return MovingAverageCrossoverStrategy(
            _integer(parameters, "fastPeriod", 2, 200),
            _integer(parameters, "slowPeriod", 3, 400),
        )
    if code == "turtle_breakout" and set(parameters) == {"entryPeriod", "exitPeriod"}:
        return TurtleBreakoutStrategy(
            _integer(parameters, "entryPeriod", 2, 250),
            _integer(parameters, "exitPeriod", 2, 250),
        )
    if code == "signal_rolling_reversal" and set(parameters) == {"confirmationBars"}:
        return SignalRollingReversalStrategy(_integer(parameters, "confirmationBars", 2, 20))
    if code == "abcd_causal" and set(parameters) == {
        "pivotLeftBars",
        "pivotRightBars",
        "retracementMin",
        "retracementMax",
        "extensionMin",
        "extensionMax",
    }:
        return AbcdCausalStrategy(
            _integer(parameters, "pivotLeftBars", 1, 10),
            _integer(parameters, "pivotRightBars", 1, 10),
            _decimal(parameters, "retracementMin", "0.1", "1.5"),
            _decimal(parameters, "retracementMax", "0.2", "2"),
            _decimal(parameters, "extensionMin", "0.5", "3"),
            _decimal(parameters, "extensionMax", "0.75", "4"),
        )
    if code == "ema_trend" and set(parameters) == {"fastPeriod", "slowPeriod"}:
        return EmaTrendStrategy(
            _integer(parameters, "fastPeriod", 2, 100),
            _integer(parameters, "slowPeriod", 3, 250),
        )
    if code == "rsi_mean_reversion" and set(parameters) == {"period", "oversold", "overbought"}:
        return RsiMeanReversionStrategy(
            _integer(parameters, "period", 2, 100),
            _decimal(parameters, "oversold", "1", "50"),
            _decimal(parameters, "overbought", "50", "99"),
        )
    if code == "bollinger_mean_reversion" and set(parameters) == {"period", "standardDeviations"}:
        return BollingerMeanReversionStrategy(
            _integer(parameters, "period", 2, 200),
            _decimal(parameters, "standardDeviations", "0.5", "5"),
        )
    if code == "macd_momentum" and set(parameters) == {"fastPeriod", "slowPeriod", "signalPeriod"}:
        return MacdMomentumStrategy(
            _integer(parameters, "fastPeriod", 2, 100),
            _integer(parameters, "slowPeriod", 3, 250),
            _integer(parameters, "signalPeriod", 2, 100),
        )
    if code == "atr_breakout" and set(parameters) == {"atrPeriod", "breakoutPeriod", "exitPeriod", "atrMultiplier"}:
        return AtrBreakoutStrategy(
            _integer(parameters, "atrPeriod", 2, 100),
            _integer(parameters, "breakoutPeriod", 2, 250),
            _integer(parameters, "exitPeriod", 2, 250),
            _decimal(parameters, "atrMultiplier", "0", "5"),
        )
    raise ValueError("Strategy parameters do not match the catalog contract.")
