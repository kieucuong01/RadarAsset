from datetime import date, datetime, timezone

from backtest.market_calendar import annualization_factor, expected_bar_timestamps, is_session_day


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
