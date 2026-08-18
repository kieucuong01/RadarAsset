from datetime import date, datetime, timezone

from backtest.market_calendar import (
    MARKET_CALENDARS,
    HOSE_CALENDAR_VERSION,
    annualization_factor,
    expected_bar_timestamps,
    is_session_day,
    timestamp_to_market_date,
)


def test_vietnam_calendar_excludes_tet_and_emits_daily_session_open() -> None:
    assert not is_session_day(date(2025, 1, 29), "vn_equity")
    assert is_session_day(date(2025, 2, 3), "vn_equity")

    timestamps = expected_bar_timestamps(
        datetime(2025, 2, 2, 17, tzinfo=timezone.utc),
        datetime(2025, 2, 3, 17, tzinfo=timezone.utc),
        timeframe="1d",
        market="vn_equity",
    )
    assert sorted(timestamps) == [
        datetime(2025, 2, 2, 17, tzinfo=timezone.utc),
        datetime(2025, 2, 3, 17, tzinfo=timezone.utc),
    ]


def test_market_annualization_is_market_and_timeframe_aware() -> None:
    assert annualization_factor("vn_equity", "1d") == 252
    assert annualization_factor("crypto_spot", "1d") == 365
    assert annualization_factor("metal_spot", "1d") == 260
    try:
        annualization_factor("crypto_spot", "1h")
    except ValueError as error:
        assert "Unsupported market/timeframe" in str(error)
    else:
        raise AssertionError("1h annualization must be retired.")


def test_xau_calendar_is_24_by_5_and_crypto_is_24_by_7() -> None:
    saturday = date(2025, 2, 1)
    assert not is_session_day(saturday, "metal_spot")
    assert is_session_day(saturday, "crypto_spot")


def test_xau_calendar_excludes_observed_full_market_holidays() -> None:
    assert not is_session_day(date(2025, 4, 18), "metal_spot")
    assert not is_session_day(date(2020, 12, 25), "metal_spot")
    assert not is_session_day(date(2021, 1, 1), "metal_spot")


def test_vietnam_market_date_uses_asia_ho_chi_minh_not_utc() -> None:
    assert timestamp_to_market_date(
        datetime(2025, 2, 3, 17, 30, tzinfo=timezone.utc), "vn_equity"
    ) == date(2025, 2, 4)


def test_calendar_version_is_explicit_and_future_dates_are_not_silently_certified() -> None:
    assert HOSE_CALENDAR_VERSION == "hose-reviewed-closures-2018-2026-v2"
    try:
        is_session_day(date(2027, 1, 4), "vn_equity", strict=True)
    except ValueError as error:
        assert "outside verified coverage" in str(error)
    else:
        raise AssertionError("Unknown future HOSE calendar must not be treated as verified.")


def test_market_calendar_contracts_declare_certified_ranges_and_sessions() -> None:
    hose = MARKET_CALENDARS["vn_equity"]
    crypto = MARKET_CALENDARS["crypto_spot"]
    gold = MARKET_CALENDARS["metal_spot"]

    assert hose.version == HOSE_CALENDAR_VERSION
    assert hose.certified_from == date(2018, 8, 20)
    assert hose.certified_to == date(2026, 12, 31)
    assert hose.hourly_opens_utc == ()
    assert crypto.weekdays == frozenset(range(7))
    assert gold.rollover_utc_hour == 22


def test_hose_calendar_covers_the_2018_source_boundary_and_excludes_tet() -> None:
    assert is_session_day(date(2018, 8, 20), "vn_equity", strict=True)
    assert not is_session_day(date(2019, 2, 4), "vn_equity", strict=True)


def test_gold_daily_calendar_excludes_weekends() -> None:
    timestamps = expected_bar_timestamps(
        datetime(2025, 1, 3, 0, tzinfo=timezone.utc),
        datetime(2025, 1, 6, 0, tzinfo=timezone.utc),
        timeframe="1d",
        market="metal_spot",
    )

    assert datetime(2025, 1, 4, 12, tzinfo=timezone.utc) not in timestamps
    assert sorted(timestamps) == [
        datetime(2025, 1, 3, 0, tzinfo=timezone.utc),
        datetime(2025, 1, 6, 0, tzinfo=timezone.utc),
    ]
