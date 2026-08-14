from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from .adapter import build_request
from .baselines import forecast_baselines
from .contracts import Bar, ForecastDistribution


METHODOLOGY = "kronos-btc-shadow-v1"


class Forecaster(Protocol):
    def forecast(self, request) -> ForecastDistribution: ...


@dataclass(frozen=True)
class EvaluationRun:
    model: str
    horizon: int
    forecast_generated_at: datetime
    max_input_ts: datetime
    forecast_for: datetime
    predicted: float
    lower: float | None
    upper: float | None
    actual: float
    cutoff_price: float
    absolute_error: float
    direction_correct: bool
    volatility_regime: str


@dataclass(frozen=True)
class EvaluationMetric:
    model: str
    mae: float
    mase: float
    directional_accuracy: float
    spearman_ic: float
    interval_coverage: float | None
    calibration_error: float | None


@dataclass(frozen=True)
class EvaluationResult:
    methodology: str
    status: str
    completed_forecasts: int
    minimum_oos: int
    runs: tuple[EvaluationRun, ...]
    metrics: tuple[EvaluationMetric, ...]
    window_start: datetime
    window_end: datetime


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _sign(value: float) -> int:
    return 1 if value > 0 else -1 if value < 0 else 0


def _rank(values: list[float]) -> list[float]:
    indexed = sorted(enumerate(values), key=lambda item: item[1])
    ranks = [0.0] * len(values)
    cursor = 0
    while cursor < len(indexed):
        end = cursor + 1
        while end < len(indexed) and indexed[end][1] == indexed[cursor][1]:
            end += 1
        average_rank = (cursor + end - 1) / 2
        for index in range(cursor, end):
            ranks[indexed[index][0]] = average_rank
        cursor = end
    return ranks


def _correlation(left: list[float], right: list[float]) -> float:
    if len(left) < 2:
        return 0.0
    left_mean, right_mean = _mean(left), _mean(right)
    numerator = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right))
    denominator = math.sqrt(
        sum((x - left_mean) ** 2 for x in left) * sum((y - right_mean) ** 2 for y in right)
    )
    return numerator / denominator if denominator else 0.0


def _quantile(values: list[float], probability: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = (len(ordered) - 1) * probability
    lower, upper = math.floor(index), math.ceil(index)
    if lower == upper:
        return ordered[lower]
    fraction = index - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def _volatility(history: list[Bar]) -> float:
    closes = [bar.close for bar in history[-31:]]
    returns = [math.log(current / previous) for previous, current in zip(closes, closes[1:])]
    return statistics.pstdev(returns) if len(returns) > 1 else 0.0


def _regime(current: float, prior: list[float]) -> str:
    if len(prior) < 20:
        return "NORMAL"
    if current <= _quantile(prior, 0.33):
        return "LOW"
    if current >= _quantile(prior, 0.67):
        return "HIGH"
    return "NORMAL"


def _metrics(model: str, records: list[EvaluationRun], naive_scale: float) -> EvaluationMetric:
    errors = [record.absolute_error for record in records]
    forecast_returns = [record.predicted / record.cutoff_price - 1 for record in records]
    actual_returns = [record.actual / record.cutoff_price - 1 for record in records]
    coverage = None
    calibration = None
    if model == "kronos-small":
        coverage = _mean(
            [float(record.lower <= record.actual <= record.upper) for record in records if record.lower is not None and record.upper is not None]
        )
        calibration = abs(coverage - 0.8)
    return EvaluationMetric(
        model=model,
        mae=_mean(errors),
        mase=_mean(errors) / naive_scale if naive_scale > 0 else 0.0,
        directional_accuracy=_mean([float(record.direction_correct) for record in records]),
        spearman_ic=_correlation(_rank(forecast_returns), _rank(actual_returns)),
        interval_coverage=coverage,
        calibration_error=calibration,
    )


def evaluate(
    history: list[Bar],
    kronos: Forecaster,
    *,
    evaluation_points: int = 180,
    minimum_oos: int = 180,
) -> EvaluationResult:
    if evaluation_points < 1 or minimum_oos < 1:
        raise ValueError("evaluation_points and minimum_oos must be positive")
    ordered = sorted(history, key=lambda bar: bar.ts)
    eligible = list(range(29, len(ordered) - 7))
    if len(eligible) < evaluation_points:
        raise ValueError("Not enough realized BTC history for the requested evaluation")
    cutoffs = eligible[-evaluation_points:]
    first_cutoff = cutoffs[0]
    training_changes = [
        abs(current.close - previous.close)
        for previous, current in zip(ordered[:first_cutoff], ordered[1 : first_cutoff + 1])
    ]
    naive_scale = _mean(training_changes) or 1.0
    observed_volatility: list[float] = []
    records: list[EvaluationRun] = []

    for cutoff_index in cutoffs:
        cutoff = ordered[cutoff_index]
        request = build_request(ordered, as_of=cutoff.ts)
        current_volatility = _volatility(list(request.history))
        regime = _regime(current_volatility, observed_volatility)
        observed_volatility.append(current_volatility)

        kronos_distribution = kronos.forecast(request)
        baseline_distributions = forecast_baselines(request)
        model_points: dict[str, dict[int, tuple[float, float | None, float | None]]] = {
            "kronos-small": {
                point.days: (point.median, point.lower, point.upper)
                for point in kronos_distribution.points
            }
        }
        for model, points in baseline_distributions.items():
            model_points[model] = {horizon: (price, None, None) for horizon, price in points.items()}

        for model, points in model_points.items():
            for horizon, (predicted, lower, upper) in points.items():
                actual_bar = ordered[cutoff_index + horizon]
                records.append(
                    EvaluationRun(
                        model=model,
                        horizon=horizon,
                        forecast_generated_at=cutoff.ts,
                        max_input_ts=request.history[-1].ts,
                        forecast_for=actual_bar.ts,
                        predicted=predicted,
                        lower=lower,
                        upper=upper,
                        actual=actual_bar.close,
                        cutoff_price=cutoff.close,
                        absolute_error=abs(predicted - actual_bar.close),
                        direction_correct=_sign(predicted - cutoff.close) == _sign(actual_bar.close - cutoff.close),
                        volatility_regime=regime,
                    )
                )

    metric_models = ("kronos-small", "random-walk", "historical-drift", "momentum-20d", "ema-trend-20d")
    metrics = tuple(
        _metrics(model, [record for record in records if record.model == model], naive_scale)
        for model in metric_models
    )
    completed = len(cutoffs)
    return EvaluationResult(
        methodology=METHODOLOGY,
        status="READY_SHADOW" if completed >= minimum_oos else "ACCUMULATING",
        completed_forecasts=completed,
        minimum_oos=minimum_oos,
        runs=tuple(records),
        metrics=metrics,
        window_start=ordered[cutoffs[0]].ts,
        window_end=ordered[cutoffs[-1]].ts,
    )
