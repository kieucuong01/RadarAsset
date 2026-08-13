from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from decimal import Decimal
from typing import Iterable

from .models import Bar, QualityIssue, QualityReport
from .market_calendar import MARKET_CALENDARS, expected_bar_timestamps, timestamp_to_market_date


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
    return expected_bar_timestamps(
        rows[0].timestamp,
        rows[-1].timestamp,
        timeframe=rows[0].timeframe,
        market=market,
    )


def _contains(
    timestamp: datetime, ranges: tuple[tuple[datetime, datetime], ...]
) -> bool:
    return any(start <= timestamp <= end for start, end in ranges)


def _classified_gap(
    timestamp: datetime,
    *,
    market: str,
    listing_start: datetime | None,
    listing_end: datetime | None,
    suspension_ranges: tuple[tuple[datetime, datetime], ...],
) -> tuple[str, str]:
    if (listing_start and timestamp < listing_start) or (
        listing_end and timestamp > listing_end
    ):
        return "LISTING_INACTIVE", "warning"
    if _contains(timestamp, suspension_ranges):
        return "SUSPENSION_UNVERIFIED", "error"
    market_day = timestamp_to_market_date(timestamp, market)
    if not MARKET_CALENDARS[market].certifies(market_day):
        return "CALENDAR_RANGE_UNVERIFIED", "error"
    return "PROVIDER_GAP", "warning"


def _collapse_missing_ranges(
    missing: list[datetime],
    expected: list[datetime],
    *,
    market: str,
    listing_start: datetime | None,
    listing_end: datetime | None,
    suspension_ranges: tuple[tuple[datetime, datetime], ...],
) -> list[QualityIssue]:
    positions = {timestamp: index for index, timestamp in enumerate(expected)}
    groups: list[tuple[str, str, list[datetime]]] = []
    for timestamp in missing:
        classification, severity = _classified_gap(
            timestamp,
            market=market,
            listing_start=listing_start,
            listing_end=listing_end,
            suspension_ranges=suspension_ranges,
        )
        if (
            groups
            and groups[-1][0] == classification
            and positions[timestamp] == positions[groups[-1][2][-1]] + 1
        ):
            groups[-1][2].append(timestamp)
        else:
            groups.append((classification, severity, [timestamp]))

    issues: list[QualityIssue] = []
    for classification, severity, timestamps in groups:
        first, last = timestamps[0], timestamps[-1]
        details: dict[str, object] = {"missingCount": len(timestamps)}
        if market == "vn_equity" and len(timestamps) == 1:
            details = {"marketDate": timestamp_to_market_date(first, market).isoformat()}
        issues.append(
            QualityIssue(
                code="MISSING_BAR",
                severity=severity,
                timestamp=first,
                classification=classification,
                range_start=first,
                range_end=last,
                details=details,
            )
        )
    return issues


def validate_bars(
    rows: Iterable[Bar],
    *,
    market: str,
    listing_start: datetime | None = None,
    listing_end: datetime | None = None,
    suspension_ranges: tuple[tuple[datetime, datetime], ...] = (),
) -> QualityReport:
    normalized = normalize_bars(rows)
    if listing_start is not None:
        listing_start = listing_start.astimezone(timezone.utc)
    if listing_end is not None:
        listing_end = listing_end.astimezone(timezone.utc)
    suspension_ranges = tuple(
        (start.astimezone(timezone.utc), end.astimezone(timezone.utc))
        for start, end in suspension_ranges
    )
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
        if (listing_start and row.timestamp < listing_start) or (
            listing_end and row.timestamp > listing_end
        ):
            issues.append(
                QualityIssue(
                    code="OUTSIDE_LISTING_RANGE",
                    severity="warning",
                    timestamp=row.timestamp,
                    classification="LISTING_INACTIVE",
                    range_start=row.timestamp,
                    range_end=row.timestamp,
                )
            )
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

    expected = sorted(_expected_timestamps(normalized, market))
    missing = [timestamp for timestamp in expected if timestamp not in seen]
    gap_issues = _collapse_missing_ranges(
        missing,
        expected,
        market=market,
        listing_start=listing_start,
        listing_end=listing_end,
        suspension_ranges=suspension_ranges,
    )
    issues.extend(gap_issues)
    if any(issue.severity == "error" for issue in issues):
        status = "failed"
    elif issues:
        status = "warning"
    else:
        status = "passed"
    missing_bar_count = sum(
        int(issue.details.get("missingCount", 1))
        for issue in gap_issues
        if issue.classification == "PROVIDER_GAP"
    )
    return QualityReport(
        status=status, missing_bar_count=missing_bar_count, issues=tuple(issues)
    )
