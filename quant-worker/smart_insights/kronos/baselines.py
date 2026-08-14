from __future__ import annotations

import math
from collections.abc import Sequence

from .contracts import Bar, ForecastRequest


def _mean(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _log_returns(history: Sequence[Bar]) -> list[float]:
    return [math.log(current.close / previous.close) for previous, current in zip(history, history[1:])]


def random_walk(history: Sequence[Bar], horizon: int) -> float:
    return history[-1].close


def historical_drift(history: Sequence[Bar], horizon: int) -> float:
    return history[-1].close * math.exp(_mean(_log_returns(history)) * horizon)


def momentum_20d(history: Sequence[Bar], horizon: int) -> float:
    returns = _log_returns(history[-21:])
    return history[-1].close * math.exp(_mean(returns) * horizon)


def ema_trend_20d(history: Sequence[Bar], horizon: int) -> float:
    alpha = 2 / 21
    log_prices = [math.log(bar.close) for bar in history]
    ema_values = [log_prices[0]]
    for value in log_prices[1:]:
        ema_values.append(alpha * value + (1 - alpha) * ema_values[-1])
    recent_slopes = [current - previous for previous, current in zip(ema_values[-21:-1], ema_values[-20:])]
    return history[-1].close * math.exp(_mean(recent_slopes) * horizon)


def forecast_baselines(request: ForecastRequest) -> dict[str, dict[int, float]]:
    models = {
        "random-walk": random_walk,
        "historical-drift": historical_drift,
        "momentum-20d": momentum_20d,
        "ema-trend-20d": ema_trend_20d,
    }
    return {
        name: {horizon: function(request.history, horizon) for horizon in request.horizons}
        for name, function in models.items()
    }
