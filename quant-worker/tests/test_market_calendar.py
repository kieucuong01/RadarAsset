from datetime import date, datetime, timezone

from backtest.market_calendar import (
    HOSE_CALENDAR_VERSION,
    annualization_factor,
    expected_bar_timestamps,
    is_session_day,
    timestamp_to_market_date,
)


def test_vietnam_calendar_excludes_tet_and_preserves_lunch_break() -> None:
    assert not is_session_day(date(2025, 1, 29), "vn_equity")
    assert is_session_day(date(2025, 2, 3), "vn_equity")

    timestamps = expected_bar_timestamps(
        datetime(2025, 2, 3, 2, tzinfo=timezone.utc),
        datetime(2025, 2, 3, 7, tzinfo=timezone.utc),
        timeframe="1h",
        market="vn_equity",
    )
    assert [item.hour for item in sorted(timestamps)] == [2, 3, 4, 6, 7]


def test_market_annualization_is_market_and_timeframe_aware() -> None:
    assert annualization_factor("vn_equity", "1d") == 252
    assert annualization_factor("vn_equity", "1h") == 1260
    assert annualization_factor("crypto_spot", "1d") == 365
    assert annualization_factor("crypto_spot", "1h") == 8760
    assert annualization_factor("metal_spot", "1d") == 260
    assert annualization_factor("metal_spot", "1h") == 6240


def test_xau_calendar_is_24_by_5_and_crypto_is_24_by_7() -> None:
    saturday = date(2025, 2, 1)
    assert not is_session_day(saturday, "metal_spot")
    assert is_session_day(saturday, "crypto_spot")


def test_vietnam_market_date_uses_asia_ho_chi_minh_not_utc() -> None:
    assert timestamp_to_market_date(
        datetime(2025, 2, 3, 17, 30, tzinfo=timezone.utc), "vn_equity"
    ) == date(2025, 2, 4)


def test_calendar_version_is_explicit_and_future_dates_are_not_silently_certified() -> None:
    assert HOSE_CALENDAR_VERSION == "hose-official-closures-2024-2026-v1"
    try:
        is_session_day(date(2027, 1, 4), "vn_equity", strict=True)
    except ValueError as error:
        assert "outside verified coverage" in str(error)
    else:
        raise AssertionError("Unknown future HOSE calendar must not be treated as verified.")
