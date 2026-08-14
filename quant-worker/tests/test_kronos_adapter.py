from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from smart_insights.kronos.adapter import (
    KronosShadowAdapter,
    RuntimeUnavailableError,
    build_request,
    load_upstream_predictor,
)
from smart_insights.kronos.contracts import Bar, RuntimeLock


def bars(count: int = 600) -> list[Bar]:
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    return [
        Bar(
            ts=start + timedelta(days=index),
            open=40_000 + index,
            high=40_100 + index,
            low=39_900 + index,
            close=40_050 + index,
            volume=1_000 + index,
        )
        for index in range(count)
    ]


class FakePathPredictor:
    def predict_close_paths(self, request):
        assert request.seed == 20260814
        return [
            [request.history[-1].close * (1 + 0.001 * day + sample * 0.0001) for day in range(1, 8)]
            for sample in range(request.sample_count)
        ]


def test_build_request_is_btc_daily_point_in_time_and_bounded() -> None:
    history = bars()
    cutoff = history[-8].ts
    request = build_request(history, as_of=cutoff, horizons=(1, 3, 7), max_context=512)

    assert request.asset == "BTC"
    assert request.timeframe == "1d"
    assert max(point.ts for point in request.history) <= cutoff
    assert len(request.history) == 512
    assert request.horizons == (1, 3, 7)


@pytest.mark.parametrize("asset,timeframe", [("ETH", "1d"), ("BTC", "1h")])
def test_build_request_rejects_non_btc_daily(asset: str, timeframe: str) -> None:
    with pytest.raises(ValueError):
        build_request(bars(40), as_of=bars(40)[-1].ts, asset=asset, timeframe=timeframe)


def test_request_rejects_duplicates_and_invalid_ohlcv() -> None:
    history = bars(40)
    with pytest.raises(ValueError):
        build_request([*history, history[-1]], as_of=history[-1].ts)
    with pytest.raises(ValueError):
        build_request([*history[:-1], Bar(history[-1].ts, 1, 0, 2, 1, -1)], as_of=history[-1].ts)


def test_adapter_produces_ordered_deterministic_quantiles() -> None:
    request = build_request(bars(80), as_of=bars(80)[-1].ts, sample_count=20)
    result = KronosShadowAdapter(FakePathPredictor()).forecast(request)

    assert [point.days for point in result.points] == [1, 3, 7]
    assert all(point.lower <= point.median <= point.upper for point in result.points)
    assert result.seed == 20260814


def test_runtime_fails_cleanly_when_optional_checkout_is_missing(tmp_path) -> None:
    lock = RuntimeLock.from_manifest(
        {
            "source": {"url": "x", "revision": "abc", "license": "MIT"},
            "model": {"id": "m", "revision": "def"},
            "tokenizer": {"id": "t", "revision": "ghi"},
        },
        runtime_root=tmp_path,
    )
    with pytest.raises(RuntimeUnavailableError):
        load_upstream_predictor(lock, device="cpu")
