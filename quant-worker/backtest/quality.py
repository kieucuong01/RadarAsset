from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Iterable

from .models import Bar, QualityIssue, QualityReport


def normalize_bars(rows: Iterable[Bar]) -> list[Bar]:
    normalized: list[Bar] = []
    for row in rows:
        if row.timestamp.tzinfo is None or row.timestamp.utcoffset() is None:
            raise ValueError("Bar timestamps must be timezone-aware.")
        normalized.append(
            Bar(
                asset=row.asset,
                timestamp=row.timestamp.astimezone(timezone.utc),
                timeframe=row.timeframe,
                open=row.open,
                high=row.high,
                low=row.low,
                close=row.close,
                volume=row.volume,
                source=row.source,
            )
        )
    return sorted(normalized, key=lambda row: (row.timestamp, row.asset))


def _decimal_text(value: Decimal | None) -> str | None:
    if value is None:
        return None
    normalized = value.normalize()
    return format(normalized, "f")


def _timestamp_text(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_bar_checksum(rows: Iterable[Bar]) -> str:
    payload = [
        {
            "asset": row.asset,
            "timestamp": _timestamp_text(row.timestamp),
            "timeframe": row.timeframe,
            "open": _decimal_text(row.open),
            "high": _decimal_text(row.high),
            "low": _decimal_text(row.low),
            "close": _decimal_text(row.close),
            "volume": _decimal_text(row.volume),
            "source": row.source,
        }
        for row in normalize_bars(rows)
    ]
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _valid_number(value: Decimal) -> bool:
    return value.is_finite() and value > 0 and math.isfinite(float(value))


def _expected_timestamps(rows: list[Bar], market: str) -> set[datetime]:
    if len(rows) < 2:
        return {row.timestamp for row in rows}
    first = rows[0].timestamp
    last = rows[-1].timestamp
    timeframe = rows[0].timeframe
    expected: set[datetime] = set()

    if timeframe == "1h" and market == "vn_equity":
        current_date = first.date()
        while current_date <= last.date():
            if current_date.weekday() < 5:
                for hour in (2, 3, 4, 6, 7):
                    candidate = datetime(
                        current_date.year,
                        current_date.month,
                        current_date.day,
                        hour,
                        tzinfo=timezone.utc,
                    )
                    if first <= candidate <= last:
                        expected.add(candidate)
            current_date += timedelta(days=1)
        return expected

    step = timedelta(hours=1) if timeframe == "1h" else timedelta(days=1)
    candidate = first
    while candidate <= last:
        if market == "crypto_spot" or candidate.weekday() < 5:
            expected.add(candidate)
        candidate += step
    return expected


def validate_bars(rows: Iterable[Bar], *, market: str) -> QualityReport:
    normalized = normalize_bars(rows)
    issues: list[QualityIssue] = []
    seen: set[datetime] = set()
    for row in normalized:
        if row.timestamp in seen:
            issues.append(
                QualityIssue(
                    code="DUPLICATE_TIMESTAMP",
                    severity="error",
                    timestamp=row.timestamp,
                )
            )
        seen.add(row.timestamp)
        valid_ohlc = (
            all(_valid_number(value) for value in (row.open, row.high, row.low, row.close))
            and row.low <= row.open <= row.high
            and row.low <= row.close <= row.high
            and (row.volume is None or (row.volume.is_finite() and row.volume >= 0))
        )
        if not valid_ohlc:
            issues.append(
                QualityIssue(code="INVALID_OHLC", severity="error", timestamp=row.timestamp)
            )

    expected = _expected_timestamps(normalized, market)
    missing = sorted(expected - seen)
    issues.extend(
        QualityIssue(code="MISSING_BAR", severity="warning", timestamp=timestamp)
        for timestamp in missing
    )
    if any(issue.severity == "error" for issue in issues):
        status = "failed"
    elif issues:
        status = "warning"
    else:
        status = "passed"
    return QualityReport(status=status, missing_bar_count=len(missing), issues=tuple(issues))
