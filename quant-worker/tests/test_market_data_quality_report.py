from datetime import datetime, timezone

from report_market_data_quality import (
    aggregate_quality_rows,
    load_quality_rows,
    normalize_daily_quality_rows,
)


class QualityCursor:
    def __init__(self) -> None:
        self.query = ""
        self.params = ()

    def execute(self, query, params) -> None:
        self.query = query
        self.params = params

    def fetchall(self):
        return []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


class QualityConnection:
    def __init__(self) -> None:
        self.cursor_value = QualityCursor()

    def cursor(self):
        return self.cursor_value


def test_quality_loader_reports_only_scoped_daily_datasets() -> None:
    connection = QualityConnection()

    assert load_quality_rows(connection, ("BTC", "FPT")) == []
    assert "dataset.timeframe = '1d'" in connection.cursor_value.query
    assert "UPPER(asset.symbol) = ANY(%s)" in connection.cursor_value.query
    assert connection.cursor_value.params == (["BTC", "FPT"],)


def test_quality_report_groups_deterministically_by_lineage_and_range() -> None:
    rows = [
        {
            "market": "crypto_spot",
            "timeframe": "1h",
            "provider_code": "binance-public",
            "classification": "PROVIDER_GAP",
            "range_start": datetime(2026, 8, 10, 1, tzinfo=timezone.utc),
            "range_end": datetime(2026, 8, 10, 2, tzinfo=timezone.utc),
            "missing_count": 2,
        },
        {
            "market": "crypto_spot",
            "timeframe": "1h",
            "provider_code": "binance-public",
            "classification": "PROVIDER_GAP",
            "range_start": datetime(2026, 8, 10, 1, tzinfo=timezone.utc),
            "range_end": datetime(2026, 8, 10, 2, tzinfo=timezone.utc),
            "missing_count": 3,
        },
        {
            "market": "vn_equity",
            "timeframe": "1d",
            "provider_code": "vnstock-vci-free",
            "classification": None,
            "range_start": None,
            "range_end": None,
            "missing_count": 10,
        },
    ]

    report = aggregate_quality_rows(rows)

    assert report == {
        "status": "degraded",
        "groupCount": 2,
        "missingBarCount": 15,
        "groups": [
            {
                "market": "crypto_spot",
                "timeframe": "1h",
                "providerCode": "binance-public",
                "classification": "PROVIDER_GAP",
                "rangeStart": "2026-08-10T01:00:00+00:00",
                "rangeEnd": "2026-08-10T02:00:00+00:00",
                "missingBarCount": 5,
            },
            {
                "market": "vn_equity",
                "timeframe": "1d",
                "providerCode": "vnstock-vci-free",
                "classification": "LEGACY_UNCLASSIFIED",
                "rangeStart": None,
                "rangeEnd": None,
                "missingBarCount": 10,
            },
        ],
    }


def test_quality_report_drops_daily_gaps_that_are_current_calendar_closures() -> None:
    rows = [
        {
            "market": "metal_spot",
            "timeframe": "1d",
            "provider_code": "dukascopy-public",
            "classification": "PROVIDER_GAP",
            "range_start": datetime(2025, 4, 18, 0, tzinfo=timezone.utc),
            "range_end": datetime(2025, 4, 18, 0, tzinfo=timezone.utc),
            "missing_count": 1,
        }
    ]

    assert normalize_daily_quality_rows(rows) == []
