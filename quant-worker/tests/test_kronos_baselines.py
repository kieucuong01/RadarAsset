from __future__ import annotations

from datetime import datetime, timedelta, timezone

from smart_insights.kronos.adapter import build_request
from smart_insights.kronos.baselines import forecast_baselines
from smart_insights.kronos.contracts import Bar


def history(count: int = 80) -> list[Bar]:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    return [
        Bar(start + timedelta(days=i), 100 + i, 102 + i, 99 + i, 101 + i, 1_000)
        for i in range(count)
    ]


def test_four_baselines_share_the_1_3_7_contract() -> None:
    bars = history()
    request = build_request(bars, as_of=bars[-8].ts)
    forecasts = forecast_baselines(request)

    assert set(forecasts) == {"random-walk", "historical-drift", "momentum-20d", "ema-trend-20d"}
    assert all(set(points) == {1, 3, 7} for points in forecasts.values())
    assert all(price > 0 for points in forecasts.values() for price in points.values())
    assert forecasts["random-walk"] == {1: request.history[-1].close, 3: request.history[-1].close, 7: request.history[-1].close}


def test_baselines_never_receive_post_cutoff_bars() -> None:
    bars = history()
    cutoff = bars[-15].ts
    request = build_request(bars, as_of=cutoff)

    assert request.history[-1].ts == cutoff
    forecasts = forecast_baselines(request)
    altered_future = [*bars[:-14], *[Bar(bar.ts, 10_000, 10_001, 9_999, 10_000, 1) for bar in bars[-14:]]]
    same_request = build_request(altered_future, as_of=cutoff)
    assert forecast_baselines(same_request) == forecasts
