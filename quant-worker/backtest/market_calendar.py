from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .models import MarketCalendarContract


HOSE_CALENDAR_VERSION = "hose-reviewed-closures-2018-2026-v2"
HOSE_TIMEZONE = ZoneInfo("Asia/Ho_Chi_Minh")
HOSE_VERIFIED_FROM = date(2018, 8, 20)
HOSE_VERIFIED_TO = date(2026, 12, 31)


# Exchange closures used by the free-data MVP. Keep these explicit and reviewed yearly;
# an unknown future weekday remains a session instead of silently inventing a holiday.
_VN_HOLIDAYS_2018_2023 = frozenset(
    date.fromisoformat(value)
    for value in (
        "2018-09-03", "2018-12-31",
        "2019-01-01", "2019-02-04", "2019-02-05", "2019-02-06", "2019-02-07", "2019-02-08",
        "2019-04-15", "2019-04-29", "2019-04-30", "2019-05-01", "2019-09-02",
        "2020-01-01", "2020-01-23", "2020-01-24", "2020-01-27", "2020-01-28", "2020-01-29",
        "2020-04-02", "2020-04-30", "2020-05-01", "2020-09-02",
        "2021-01-01", "2021-02-10", "2021-02-11", "2021-02-12", "2021-02-15", "2021-02-16",
        "2021-04-21", "2021-04-30", "2021-05-03", "2021-09-02", "2021-09-03",
        "2022-01-03", "2022-01-31", "2022-02-01", "2022-02-02", "2022-02-03", "2022-02-04",
        "2022-04-11", "2022-05-02", "2022-05-03", "2022-09-01", "2022-09-02",
        "2023-01-02", "2023-01-20", "2023-01-23", "2023-01-24", "2023-01-25", "2023-01-26",
        "2023-05-01", "2023-05-02", "2023-05-03", "2023-09-01", "2023-09-04",
    )
)

_VN_HOLIDAYS_2024_2026 = {
    # 2024
    date(2024, 1, 1),
    *[date(2024, 2, day) for day in range(8, 15)],
    date(2024, 4, 18),
    date(2024, 4, 29),
    date(2024, 4, 30),
    date(2024, 5, 1),
    date(2024, 9, 2),
    date(2024, 9, 3),
    # 2025
    date(2025, 1, 1),
    *[date(2025, 1, day) for day in range(27, 32)],
    date(2025, 4, 7),
    date(2025, 4, 30),
    date(2025, 5, 1),
    date(2025, 5, 2),
    date(2025, 9, 1),
    date(2025, 9, 2),
    # 2026
    date(2026, 1, 1),
    date(2026, 1, 2),
    *[date(2026, 2, day) for day in range(16, 21)],
    date(2026, 4, 27),
    date(2026, 4, 30),
    date(2026, 5, 1),
    date(2026, 9, 1),
    date(2026, 9, 2),
}

_VN_HOLIDAYS = _VN_HOLIDAYS_2018_2023 | frozenset(_VN_HOLIDAYS_2024_2026)

# Full-session OTC gold closures observed in the certified Dukascopy daily
# history. Partial sessions remain valid bars and are intentionally retained.
_XAU_FULL_SESSION_HOLIDAYS = frozenset(
    {
        date(2013, 3, 29),
        date(2013, 12, 25),
        date(2014, 4, 18),
        date(2015, 4, 3),
        date(2015, 12, 25),
        date(2016, 1, 1),
        date(2016, 3, 25),
        date(2017, 4, 14),
        date(2018, 3, 30),
        date(2019, 4, 19),
        date(2020, 4, 10),
        date(2020, 12, 25),
        date(2021, 1, 1),
        date(2021, 4, 2),
        date(2021, 12, 24),
        date(2022, 4, 15),
        date(2023, 4, 7),
        date(2024, 3, 29),
        date(2025, 4, 18),
        date(2026, 4, 3),
    }
)

_ANNUALIZATION = {
    ("vn_equity", "1d"): 252,
    ("crypto_spot", "1d"): 365,
    ("metal_spot", "1d"): 260,
}

MARKET_CALENDARS = {
    "vn_equity": MarketCalendarContract(
        market="vn_equity",
        venue="HOSE",
        timezone_name="Asia/Ho_Chi_Minh",
        version=HOSE_CALENDAR_VERSION,
        certified_from=HOSE_VERIFIED_FROM,
        certified_to=HOSE_VERIFIED_TO,
        weekdays=frozenset(range(5)),
        closure_dates=frozenset(_VN_HOLIDAYS),
    ),
    "crypto_spot": MarketCalendarContract(
        market="crypto_spot",
        venue="BINANCE",
        timezone_name="UTC",
        version="crypto-24x7-v1",
        certified_from=None,
        certified_to=None,
        weekdays=frozenset(range(7)),
    ),
    "metal_spot": MarketCalendarContract(
        market="metal_spot",
        venue="OTC",
        timezone_name="UTC",
        version="xau-24x5-full-closures-2013-2026-v2",
        certified_from=None,
        certified_to=None,
        weekdays=frozenset(range(5)),
        closure_dates=_XAU_FULL_SESSION_HOLIDAYS,
        rollover_utc_hour=22,
    ),
}


def annualization_factor(market: str, timeframe: str) -> int:
    try:
        return _ANNUALIZATION[(market, timeframe)]
    except KeyError as error:
        raise ValueError(f"Unsupported market/timeframe: {market}/{timeframe}.") from error


def timestamp_to_market_date(timestamp: datetime, market: str) -> date:
    if timestamp.tzinfo is None:
        raise ValueError("Market timestamp must be timezone-aware.")
    zone = HOSE_TIMEZONE if market == "vn_equity" else timezone.utc
    return timestamp.astimezone(zone).date()


def is_session_day(day: date, market: str, *, strict: bool = False) -> bool:
    try:
        contract = MARKET_CALENDARS[market]
    except KeyError as error:
        raise ValueError(f"Unsupported market: {market}.") from error
    if market == "vn_equity":
        if strict and not contract.certifies(day):
            raise ValueError("HOSE date is outside verified coverage.")
    return day.weekday() in contract.weekdays and day not in contract.closure_dates


def expected_bar_timestamps(
    start: datetime,
    end: datetime,
    *,
    timeframe: str,
    market: str,
) -> set[datetime]:
    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("Calendar boundaries must be timezone-aware.")
    start = start.astimezone(timezone.utc)
    end = end.astimezone(timezone.utc)
    if end < start:
        return set()
    if timeframe != "1d":
        raise ValueError(f"Unsupported timeframe: {timeframe}.")

    if timeframe == "1d" and market == "vn_equity":
        result: set[datetime] = set()
        first_market_day = timestamp_to_market_date(start, market)
        last_market_day = timestamp_to_market_date(end, market)
        anchor_time = start.astimezone(HOSE_TIMEZONE).timetz().replace(tzinfo=None)
        current = first_market_day
        while current <= last_market_day:
            if is_session_day(current, market):
                candidate = datetime.combine(current, anchor_time, tzinfo=HOSE_TIMEZONE).astimezone(
                    timezone.utc
                )
                if start <= candidate <= end:
                    result.add(candidate)
            current += timedelta(days=1)
        return result

    step = timedelta(days=1)
    candidate = start
    result = set()
    while candidate <= end:
        if is_session_day(candidate.date(), market):
            result.add(candidate)
        candidate += step
    return result
