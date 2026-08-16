from datetime import datetime, timedelta, timezone
from decimal import Decimal

from smart_insights.opinion_evaluation import (
    OpinionSignal,
    PricePoint,
    benchmark_for_market,
    direction_from_stance,
    evaluate_signal,
)


UTC = timezone.utc
START = datetime(2026, 7, 1, tzinfo=UTC)


def prices(symbol: str, closes: list[str]) -> tuple[PricePoint, ...]:
    return tuple(
        PricePoint(
            symbol=symbol,
            timestamp=START + timedelta(days=index),
            close=Decimal(close),
            dataset_version_id=f"version-{symbol}",
            adjustment_policy="raw",
        )
        for index, close in enumerate(closes)
    )


def signal(stance: str = "CONSTRUCTIVE") -> OpinionSignal:
    return OpinionSignal(
        signal_snapshot_id="signal-1",
        organization_id="org-1",
        user_id="user-1",
        asset_symbol="ETH",
        benchmark_symbol="BTC",
        effective_at=START,
        stance=stance,
        quant_score=Decimal("35"),
    )


def test_direction_mapping_excludes_neutral_and_insufficient_views() -> None:
    assert direction_from_stance("POSITIVE") == 1
    assert direction_from_stance("CONSTRUCTIVE") == 1
    assert direction_from_stance("CAUTIOUS") == -1
    assert direction_from_stance("NEGATIVE") == -1
    assert direction_from_stance("NEUTRAL") is None
    assert direction_from_stance("INSUFFICIENT_DATA") is None
    assert benchmark_for_market("vn_equity", "FPT") == "VNINDEX"
    assert benchmark_for_market("crypto_spot", "ETH") == "BTC"
    assert benchmark_for_market("metal_spot", "XAU") == "XAU"


def test_evaluation_enters_next_session_and_uses_exact_holding_horizon() -> None:
    result = evaluate_signal(
        signal(),
        asset_prices=prices("ETH", ["100", "110", "121", "133.1"]),
        benchmark_prices=prices("BTC", ["200", "200", "210", "210"]),
        horizon_sessions=1,
        evaluated_at=START + timedelta(days=3),
    )

    assert result is not None
    assert result.entry_timestamp == START + timedelta(days=1)
    assert result.target_timestamp == START + timedelta(days=2)
    assert result.asset_return == Decimal("0.1")
    assert result.benchmark_return == Decimal("0.05")
    assert result.excess_return == Decimal("0.05")
    assert result.correct is True


def test_negative_view_is_correct_when_realized_return_is_negative() -> None:
    result = evaluate_signal(
        signal("NEGATIVE"),
        asset_prices=prices("ETH", ["100", "100", "90"]),
        benchmark_prices=prices("BTC", ["100", "100", "100"]),
        horizon_sessions=1,
        evaluated_at=START + timedelta(days=2),
    )

    assert result is not None
    assert result.asset_return == Decimal("-0.1")
    assert result.correct is True


def test_evaluation_returns_none_without_closed_target_or_exact_benchmark_dates() -> None:
    asset = prices("ETH", ["100", "110", "120"])
    benchmark = prices("BTC", ["200", "210"])

    assert (
        evaluate_signal(
            signal(),
            asset_prices=asset,
            benchmark_prices=benchmark,
            horizon_sessions=1,
            evaluated_at=START + timedelta(days=1, hours=23),
        )
        is None
    )
    assert (
        evaluate_signal(
            signal(),
            asset_prices=asset,
            benchmark_prices=benchmark,
            horizon_sessions=1,
            evaluated_at=START + timedelta(days=3),
        )
        is None
    )


def test_neutral_signal_is_not_scored() -> None:
    assert (
        evaluate_signal(
            signal("NEUTRAL"),
            asset_prices=prices("ETH", ["100", "110", "120"]),
            benchmark_prices=prices("BTC", ["100", "110", "120"]),
            horizon_sessions=1,
            evaluated_at=START + timedelta(days=3),
        )
        is None
    )
