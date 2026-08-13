from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo


HOSE_CALENDAR_VERSION = "hose-official-closures-2024-2026-v1"
HOSE_TIMEZONE = ZoneInfo("Asia/Ho_Chi_Minh")
HOSE_VERIFIED_FROM = date(2024, 1, 1)
HOSE_VERIFIED_TO = date(2026, 12, 31)


# Exchange closures used by the free-data MVP. Keep these explicit and reviewed yearly;
# an unknown future weekday remains a session instead of silently inventing a holiday.
_VN_HOLIDAYS = {
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

_ANNUALIZATION = {
    ("vn_equity", "1d"): 252,
    ("vn_equity", "1h"): 1_260,
    ("crypto_spot", "1d"): 365,
    ("crypto_spot", "1h"): 8_760,
    ("metal_spot", "1d"): 260,
    ("metal_spot", "1h"): 6_240,
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
    if market == "crypto_spot":
        return True
    if market == "vn_equity":
        if strict and not HOSE_VERIFIED_FROM <= day <= HOSE_VERIFIED_TO:
            raise ValueError("HOSE date is outside verified coverage.")
        return day.weekday() < 5 and day not in _VN_HOLIDAYS
    if market == "metal_spot":
        return day.weekday() < 5
    raise ValueError(f"Unsupported market: {market}.")


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
    if timeframe not in {"1d", "1h"}:
        raise ValueError(f"Unsupported timeframe: {timeframe}.")

    if timeframe == "1h" and market == "vn_equity":
        result: set[datetime] = set()
        current = start.date()
        while current <= end.date():
            if is_session_day(current, market):
                for hour in (2, 3, 4, 6, 7):
                    candidate = datetime.combine(current, time(hour), tzinfo=timezone.utc)
                    if start <= candidate <= end:
                        result.add(candidate)
            current += timedelta(days=1)
        return result

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

    step = timedelta(hours=1) if timeframe == "1h" else timedelta(days=1)
    candidate = start
    result = set()
    while candidate <= end:
        if is_session_day(candidate.date(), market):
            result.add(candidate)
        candidate += step
    return result
