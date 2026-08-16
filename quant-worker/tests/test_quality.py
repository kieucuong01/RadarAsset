from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from backtest.models import Bar
from backtest.quality import canonical_bar_checksum, normalize_bars, validate_bars


def bar(ts: str, *, asset: str = "BTC", timeframe: str = "1d", close: str = "101") -> Bar:
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
        "58bb07433ae7e8cce7ddcc28037243005839374e23a2cb23202db97d3ece5f40"
    )


def test_crypto_daily_quality_reports_the_exact_missing_bar() -> None:
    report = validate_bars(
        [
            bar("2024-01-01T00:00:00Z"),
            bar("2024-01-02T00:00:00Z"),
            bar("2024-01-04T00:00:00Z"),
        ],
        market="crypto_spot",
    )

    assert report.missing_bar_count == 1
    assert [(issue.code, issue.severity, issue.timestamp.isoformat()) for issue in report.issues] == [
        ("MISSING_BAR", "warning", "2024-01-03T00:00:00+00:00")
    ]
    assert report.status == "warning"


def test_vietnam_daily_quality_understands_trading_sessions() -> None:
    rows = [
        bar("2024-01-01T17:00:00Z", asset="FPT"),
        bar("2024-01-03T17:00:00Z", asset="FPT"),
    ]

    report = validate_bars(rows, market="vn_equity")

    assert report.missing_bar_count == 1
    assert report.issues[0].timestamp == datetime(2024, 1, 2, 17, tzinfo=timezone.utc)


def test_vietnam_daily_quality_does_not_flag_tet_holiday() -> None:
    report = validate_bars(
        [
            bar("2025-01-28T00:00:00Z", asset="FPT", timeframe="1d"),
            bar("2025-02-03T00:00:00Z", asset="FPT", timeframe="1d"),
        ],
        market="vn_equity",
    )

    assert report.missing_bar_count == 0


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


def test_vietnam_daily_missing_bars_compare_market_dates_not_utc_anchors() -> None:
    report = validate_bars(
        [
            bar("2025-02-03T17:00:00Z", asset="FPT", timeframe="1d"),
            bar("2025-02-05T17:00:00Z", asset="FPT", timeframe="1d"),
        ],
        market="vn_equity",
    )

    assert report.missing_bar_count == 1
    assert report.issues[0].details == {"marketDate": "2025-02-05"}


def test_gap_ranges_classify_listing_suspension_provider_and_calendar_boundaries() -> None:
    rows = [
        bar("2026-12-30T00:00:00Z", asset="FPT", timeframe="1d"),
        bar("2027-01-06T00:00:00Z", asset="FPT", timeframe="1d"),
    ]

    report = validate_bars(
        rows,
        market="vn_equity",
        listing_start=datetime(2026, 12, 31, tzinfo=timezone.utc),
        suspension_ranges=((
            datetime(2027, 1, 4, tzinfo=timezone.utc),
            datetime(2027, 1, 4, tzinfo=timezone.utc),
        ),),
    )

    classifications = {issue.classification for issue in report.issues}
    assert "LISTING_INACTIVE" in classifications
    assert "PROVIDER_GAP" in classifications
    assert "SUSPENSION_UNVERIFIED" in classifications
    assert "CALENDAR_RANGE_UNVERIFIED" in classifications
    assert report.status == "failed"
    assert report.missing_bar_count == 1


def test_adjacent_provider_gaps_collapse_into_one_bounded_range() -> None:
    report = validate_bars(
        [
            bar("2024-01-01T00:00:00Z"),
            bar("2024-01-05T00:00:00Z"),
        ],
        market="crypto_spot",
    )

    assert report.missing_bar_count == 3
    assert len(report.issues) == 1
    issue = report.issues[0]
    assert issue.classification == "PROVIDER_GAP"
    assert issue.range_start == datetime(2024, 1, 2, tzinfo=timezone.utc)
    assert issue.range_end == datetime(2024, 1, 4, tzinfo=timezone.utc)
    assert issue.details["missingCount"] == 3


def test_expected_closures_are_not_provider_gaps() -> None:
    report = validate_bars(
        [
            bar("2025-01-28T00:00:00Z", asset="FPT", timeframe="1d"),
            bar("2025-02-03T00:00:00Z", asset="FPT", timeframe="1d"),
        ],
        market="vn_equity",
    )

    assert report.missing_bar_count == 0
    assert all(issue.classification != "PROVIDER_GAP" for issue in report.issues)
