from __future__ import annotations

from datetime import datetime, timedelta, timezone

from smart_insights.kronos.contracts import Bar, ForecastDistribution, ForecastPoint
from smart_insights.kronos.evaluation import evaluate


def history(count: int = 240) -> list[Bar]:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    result = []
    close = 40_000.0
    for index in range(count):
        close *= 1 + (0.004 if index % 5 else -0.002)
        result.append(Bar(start + timedelta(days=index), close - 10, close + 40, close - 40, close, 1_000 + index))
    return result


class FakeKronos:
    def forecast(self, request):
        last = request.history[-1].close
        points = tuple(
            ForecastPoint(
                days=days,
                forecast_for=request.as_of + timedelta(days=days),
                lower=last * (1 + 0.001 * days),
                median=last * (1 + 0.003 * days),
                upper=last * (1 + 0.005 * days),
            )
            for days in request.horizons
        )
        return ForecastDistribution(points, request.seed, request.sample_count, request.temperature, request.top_p)


def test_anchored_walk_forward_has_no_lookahead_and_accumulates() -> None:
    result = evaluate(history(), FakeKronos(), evaluation_points=40, minimum_oos=180)

    assert result.status == "ACCUMULATING"
    assert result.completed_forecasts == 40
    assert all(run.max_input_ts <= run.forecast_generated_at for run in result.runs)
    assert all(run.forecast_for <= history()[-1].ts for run in result.runs)
    assert {metric.model for metric in result.metrics} == {
        "kronos-small",
        "random-walk",
        "historical-drift",
        "momentum-20d",
        "ema-trend-20d",
    }


def test_metrics_and_ready_shadow_gate_after_180_completed_dates() -> None:
    result = evaluate(history(230), FakeKronos(), evaluation_points=180, minimum_oos=180)

    assert result.status == "READY_SHADOW"
    assert result.completed_forecasts == 180
    kronos = next(metric for metric in result.metrics if metric.model == "kronos-small")
    assert kronos.mae >= 0
    assert kronos.mase >= 0
    assert 0 <= kronos.directional_accuracy <= 1
    assert -1 <= kronos.spearman_ic <= 1
    assert 0 <= kronos.interval_coverage <= 1
    assert abs(kronos.calibration_error - abs(kronos.interval_coverage - 0.8)) < 1e-9
    assert {run.volatility_regime for run in result.runs} <= {"LOW", "NORMAL", "HIGH"}
