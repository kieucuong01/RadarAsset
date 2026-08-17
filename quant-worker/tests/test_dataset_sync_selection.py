from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timezone

import pytest

from dataset_sync.selection import EligibilityCandidate, classify_candidate, scan_datasets


NOW = datetime(2026, 8, 17, tzinfo=timezone.utc)


def _candidate() -> EligibilityCandidate:
    return EligibilityCandidate(
        dataset_version_id="00000000-0000-0000-0000-000000000001",
        provider_code="binance-public",
        provider_active=True,
        instrument_active=True,
        canonical_key="CRYPTO:BTC",
        symbol="BTC",
        market="crypto_spot",
        timeframe="1d",
        adjustment_policy="raw",
        coverage_end=datetime(2026, 8, 15, tzinfo=timezone.utc),
        declared_row_count=3,
        actual_row_count=3,
        quality_status="passed",
        source_metadata={"mode": "live"},
        row_sources=("binance-public",),
    )


@pytest.mark.parametrize(
    ("changes", "status"),
    [
        ({"timeframe": "1h"}, "skipped_invalid"),
        ({"adjustment_policy": "total_return"}, "skipped_invalid"),
        ({"market": "us_equity"}, "skipped_invalid"),
        ({"provider_code": "unknown-provider"}, "skipped_untrusted"),
        ({"quality_status": "failed"}, "skipped_quality"),
        ({"coverage_end": datetime(2026, 8, 13, tzinfo=timezone.utc)}, "skipped_stale"),
        ({"source_metadata": {"mode": "research_fixture"}}, "skipped_untrusted"),
        ({"row_sources": ("live", "simulated")}, "skipped_untrusted"),
        ({"actual_row_count": 2}, "skipped_invalid"),
    ],
)
def test_classifier_rejects_nonproduction_daily_data(
    changes: dict[str, object], status: str
) -> None:
    result = classify_candidate(replace(_candidate(), **changes), now=NOW)

    assert result.status == status


def test_classifier_allows_warning_data_without_hiding_its_quality_status() -> None:
    candidate = replace(_candidate(), quality_status="warning")

    result = classify_candidate(candidate, now=NOW)

    assert result.status == "eligible"
    assert result.candidate.quality_status == "warning"


class _Cursor:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.query = ""

    def __enter__(self) -> _Cursor:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, query: str) -> None:
        self.query = query

    def fetchall(self) -> list[dict[str, object]]:
        return self.rows


class _Connection:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.cursor_instance = _Cursor(rows)

    def cursor(self, **_: object) -> _Cursor:
        return self.cursor_instance


def test_scanner_counts_stored_bars_before_marking_dataset_eligible() -> None:
    connection = _Connection(
        [
            {
                "dataset_version_id": "00000000-0000-0000-0000-000000000001",
                "provider_code": "binance-public",
                "provider_active": True,
                "instrument_active": True,
                "canonical_key": "CRYPTO:BTC",
                "symbol": "BTC",
                "market": "crypto_spot",
                "timeframe": "1d",
                "adjustment_policy": "raw",
                "coverage_end": datetime(2026, 8, 15, tzinfo=timezone.utc),
                "declared_row_count": 3,
                "actual_row_count": 3,
                "quality_status": "passed",
                "source_metadata": {"mode": "live"},
                "row_sources": ["binance-public"],
            }
        ]
    )

    report = scan_datasets(connection, now=NOW)

    assert report.counts == {"eligible": 1}
    assert report.decisions[0].status == "eligible"
    assert "version.is_active = true" in connection.cursor_instance.query
    assert "COUNT(bar.id)::int AS actual_row_count" in connection.cursor_instance.query


def test_scanner_treats_database_date_coverage_as_midnight_utc() -> None:
    connection = _Connection(
        [
            {
                "dataset_version_id": "00000000-0000-0000-0000-000000000001",
                "provider_code": "binance-public",
                "provider_active": True,
                "instrument_active": True,
                "canonical_key": "CRYPTO:BTC",
                "symbol": "BTC",
                "market": "crypto_spot",
                "timeframe": "1d",
                "adjustment_policy": "raw",
                "coverage_end": date(2026, 8, 15),
                "declared_row_count": 3,
                "actual_row_count": 3,
                "quality_status": "passed",
                "source_metadata": {"mode": "live"},
                "row_sources": ["binance-public"],
            }
        ]
    )

    report = scan_datasets(connection, now=NOW)

    assert report.counts == {"eligible": 1}
    assert report.decisions[0].candidate.coverage_end == datetime(2026, 8, 15, tzinfo=timezone.utc)


def test_scanner_treats_naive_database_timestamp_as_utc() -> None:
    row = {
        "dataset_version_id": "00000000-0000-0000-0000-000000000001",
        "provider_code": "binance-public",
        "provider_active": True,
        "instrument_active": True,
        "canonical_key": "CRYPTO:BTC",
        "symbol": "BTC",
        "market": "crypto_spot",
        "timeframe": "1d",
        "adjustment_policy": "raw",
        "coverage_end": datetime(2026, 8, 15),
        "declared_row_count": 3,
        "actual_row_count": 3,
        "quality_status": "passed",
        "source_metadata": {"mode": "live"},
        "row_sources": ["binance-public"],
    }

    report = scan_datasets(_Connection([row]), now=NOW)

    assert report.counts == {"eligible": 1}
    assert report.decisions[0].candidate.coverage_end.tzinfo is timezone.utc
