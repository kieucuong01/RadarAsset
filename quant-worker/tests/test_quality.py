from datetime import datetime, timezone
from decimal import Decimal

import pytest

from backtest.models import Bar
from backtest.quality import canonical_bar_checksum, normalize_bars, validate_bars


def bar(ts: str, *, asset: str = "BTC", timeframe: str = "1h", close: str = "101") -> Bar:
    return Bar(
        asset=asset,
        timestamp=datetime.fromisoformat(ts.replace("Z", "+00:00")),
        timeframe=timeframe,
        open=Decimal("100"),
        high=Decimal("102"),
        low=Decimal("99"),
        close=Decimal(close),
        volume=Decimal("10"),
        source="fixture",
    )


def test_normalize_bars_sorts_utc_rows_and_checksum_is_order_independent() -> None:
    later = bar("2024-01-01T01:00:00Z", close="101.5000")
    earlier = bar("2024-01-01T00:00:00Z", close="100.5")

    normalized = normalize_bars([later, earlier])

    assert [item.timestamp.isoformat() for item in normalized] == [
        "2024-01-01T00:00:00+00:00",
        "2024-01-01T01:00:00+00:00",
    ]
    assert canonical_bar_checksum(normalized) == canonical_bar_checksum([earlier, later])
    assert canonical_bar_checksum(normalized) == (
        "d5340176a8e9e00ddf246a1defd42f117b2141d47b812b2f4f9d31d280e333a8"
    )


def test_crypto_hourly_quality_reports_the_exact_missing_bar() -> None:
    report = validate_bars(
        [
            bar("2024-01-01T00:00:00Z"),
            bar("2024-01-01T01:00:00Z"),
            bar("2024-01-01T03:00:00Z"),
        ],
        market="crypto_spot",
    )

    assert report.missing_bar_count == 1
    assert [(issue.code, issue.severity, issue.timestamp.isoformat()) for issue in report.issues] == [
        ("MISSING_BAR", "warning", "2024-01-01T02:00:00+00:00")
    ]
    assert report.status == "warning"


def test_vietnam_hourly_quality_understands_trading_sessions_and_lunch_break() -> None:
    rows = [
        bar("2024-01-02T02:00:00Z", asset="FPT"),
        bar("2024-01-02T04:00:00Z", asset="FPT"),
        bar("2024-01-02T06:00:00Z", asset="FPT"),
        bar("2024-01-02T07:00:00Z", asset="FPT"),
    ]

    report = validate_bars(rows, market="vn_equity")

    assert report.missing_bar_count == 1
    assert report.issues[0].timestamp == datetime(2024, 1, 2, 3, tzinfo=timezone.utc)


def test_gold_daily_quality_does_not_treat_weekend_as_missing() -> None:
    report = validate_bars(
        [
            bar("2024-01-05T00:00:00Z", asset="XAU", timeframe="1d"),
            bar("2024-01-08T00:00:00Z", asset="XAU", timeframe="1d"),
        ],
        market="metal_spot",
    )

    assert report.missing_bar_count == 0
    assert report.status == "passed"


def test_duplicate_timestamp_and_invalid_ohlc_are_high_severity() -> None:
    first = bar("2024-01-01T00:00:00Z")
    duplicate = bar("2024-01-01T00:00:00Z", close="150")

    report = validate_bars([first, duplicate], market="crypto_spot")

    assert [(issue.code, issue.severity) for issue in report.issues] == [
        ("DUPLICATE_TIMESTAMP", "error"),
        ("INVALID_OHLC", "error"),
    ]
    assert report.status == "failed"


def test_naive_timestamps_are_rejected_at_the_normalization_boundary() -> None:
    row = bar("2024-01-01T00:00:00Z")
    row = Bar(**{**row.__dict__, "timestamp": datetime(2024, 1, 1)})

    with pytest.raises(ValueError, match="timezone-aware"):
        normalize_bars([row])
