from datetime import datetime, timezone
from decimal import Decimal
import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
import pytest

from backtest.models import Bar
from backtest.publication import PostgresDatasetPublisher, prepare_dataset_publication
from backtest.quality import canonical_bar_checksum


def _test_database_url() -> str:
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests.")
    parts = urlsplit(raw_url)
    query = urlencode(
        [(key, value) for key, value in parse_qsl(parts.query) if key != "schema"]
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def test_publication_checksum_survives_a_non_utc_database_session() -> None:
    suffix = uuid4().hex[:8]
    symbol = f"QATZ{suffix}"
    provider_code = f"qa-timezone-{suffix}"
    bars = [
        Bar(
            asset=symbol,
            timestamp=datetime(2024, 1, 1, hour, tzinfo=timezone.utc),
            timeframe="1d",
            open=Decimal("100.00000000"),
            high=Decimal("102.00000000"),
            low=Decimal("99.00000000"),
            close=Decimal("101.00000000"),
            volume=Decimal("10.0000"),
            source="qa-timezone",
        )
        for hour in range(3)
    ]
    prepared = prepare_dataset_publication(
        bars,
        market="crypto_spot",
        provider_code=provider_code,
        provider_name="QA timezone provider",
        provider_symbol=symbol,
        canonical_key=f"QA:TIMEZONE:{symbol}",
        asset_name="QA timezone asset",
        currency="USD",
        venue="QA",
        timezone_name="UTC",
        maximum_leverage=Decimal("1"),
        terms_url=None,
        source_metadata={"mode": "integration-test"},
    )

    connection = psycopg.connect(_test_database_url(), row_factory=dict_row)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET TIME ZONE 'Asia/Bangkok'")
        result = PostgresDatasetPublisher(connection).publish(prepared)
        connection.commit()

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT ts, open, high, low, close, volume, source
                FROM dataset_bars
                WHERE dataset_version_id = %s
                ORDER BY ts
                """,
                (result["datasetVersionId"],),
            )
            stored_rows = cursor.fetchall()
        round_tripped = [
            Bar(
                asset=symbol,
                timestamp=row["ts"].replace(tzinfo=row["ts"].tzinfo or timezone.utc),
                timeframe="1d",
                open=Decimal(str(row["open"])),
                high=Decimal(str(row["high"])),
                low=Decimal(str(row["low"])),
                close=Decimal(str(row["close"])),
                volume=Decimal(str(row["volume"])),
                source=str(row["source"]),
            )
            for row in stored_rows
        ]

        assert canonical_bar_checksum(round_tripped) == prepared.checksum
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT classification, range_start, range_end
                FROM data_quality_issues
                WHERE dataset_version_id = %s
                ORDER BY range_start
                """,
                (result["datasetVersionId"],),
            )
            issue = cursor.fetchone()
        assert issue is None
    finally:
        connection.rollback()
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM assets WHERE symbol = %s", (symbol,))
            cursor.execute("DELETE FROM data_providers WHERE code = %s", (provider_code,))
        connection.commit()
        connection.close()


def test_publish_if_changed_reuses_checksum_and_activates_only_a_correction() -> None:
    suffix = uuid4().hex[:8]
    symbol = f"QAID{suffix}"
    provider_code = f"qa-idempotent-{suffix}"

    def prepare(close_at_one: str):
        bars = [
            Bar(
                asset=symbol,
                timestamp=datetime(2026, 8, 10, hour, tzinfo=timezone.utc),
                timeframe="1d",
                open=Decimal("100"),
                high=Decimal("110"),
                low=Decimal("90"),
                close=Decimal(close_at_one if hour == 1 else "100"),
                volume=Decimal("10"),
                source="qa-live",
            )
            for hour in range(3)
        ]
        return prepare_dataset_publication(
            bars,
            market="crypto_spot",
            provider_code=provider_code,
            provider_name="QA idempotent provider",
            provider_symbol=symbol,
            canonical_key=f"QA:IDEMPOTENT:{symbol}",
            asset_name="QA idempotent asset",
            currency="USD",
            venue="QA",
            timezone_name="UTC",
            maximum_leverage=Decimal("1"),
            terms_url=None,
            source_metadata={"mode": "live", "upstreamProvider": "qa"},
        )

    connection = psycopg.connect(_test_database_url(), row_factory=dict_row)
    try:
        publisher = PostgresDatasetPublisher(connection)
        first = publisher.publish_if_changed(prepare("101"))
        connection.commit()
        unchanged = publisher.publish_if_changed(prepare("101"))
        connection.commit()
        corrected = publisher.publish_if_changed(prepare("105"))
        connection.commit()

        assert first.status == "succeeded"
        assert unchanged.status == "unchanged"
        assert unchanged.dataset_version_id == first.dataset_version_id
        assert corrected.status == "succeeded"
        assert corrected.version == 2

        active = publisher.load_active(symbol, "1d")
        assert active is not None
        assert active.dataset_version_id == corrected.dataset_version_id
        assert active.version == 2
        assert active.rows[1].close == Decimal("105.00000000")
        assert active.source_metadata["mode"] == "live"

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS version_count,
                       COUNT(*) FILTER (WHERE is_active) AS active_count
                FROM dataset_versions dv
                JOIN datasets d ON d.id = dv.dataset_id
                JOIN assets a ON a.id = d.asset_id
                WHERE a.symbol = %s AND d.timeframe = '1d'
                """,
                (symbol,),
            )
            counts = cursor.fetchone()
        assert counts == {"version_count": 2, "active_count": 1}
    finally:
        connection.rollback()
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM assets WHERE symbol = %s", (symbol,))
            cursor.execute("DELETE FROM data_providers WHERE code = %s", (provider_code,))
        connection.commit()
        connection.close()


def test_publication_persists_bounded_provider_gap_lineage() -> None:
    suffix = uuid4().hex[:8]
    symbol = f"QAGP{suffix}"
    provider_code = f"qa-gap-{suffix}"
    rows = [
        Bar(
            asset=symbol,
            timestamp=datetime(2026, 8, 10, hour, tzinfo=timezone.utc),
            timeframe="1d",
            open=Decimal("100"),
            high=Decimal("101"),
            low=Decimal("99"),
            close=Decimal("100"),
            volume=Decimal("10"),
            source="qa-live",
        )
        for hour in (0, 3)
    ]
    prepared = prepare_dataset_publication(
        rows,
        market="crypto_spot",
        provider_code=provider_code,
        provider_name="QA gap provider",
        provider_symbol=symbol,
        canonical_key=f"QA:GAP:{symbol}",
        asset_name="QA gap asset",
        currency="USD",
        venue="QA",
        timezone_name="UTC",
        maximum_leverage=Decimal("1"),
        terms_url=None,
        source_metadata={"mode": "live"},
    )
    connection = psycopg.connect(_test_database_url(), row_factory=dict_row)
    try:
        result = PostgresDatasetPublisher(connection).publish(prepared)
        connection.commit()
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT classification, range_start, range_end, details FROM data_quality_issues WHERE dataset_version_id = %s",
                (result["datasetVersionId"],),
            )
            issue = cursor.fetchone()
            cursor.execute(
                "SELECT quality_summary, source_metadata FROM dataset_versions WHERE id = %s",
                (result["datasetVersionId"],),
            )
            manifest = cursor.fetchone()
        assert issue["classification"] == "PROVIDER_GAP"
        assert issue["range_start"] == datetime(2026, 8, 10, 1, tzinfo=timezone.utc)
        assert issue["range_end"] == datetime(2026, 8, 10, 2, tzinfo=timezone.utc)
        assert issue["details"]["missingCount"] == 2
        assert manifest["quality_summary"]["classificationCounts"] == {"PROVIDER_GAP": 1}
        assert manifest["source_metadata"]["calendarVersion"] == "crypto-24x7-v1"
    finally:
        connection.rollback()
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM assets WHERE symbol = %s", (symbol,))
            cursor.execute("DELETE FROM data_providers WHERE code = %s", (provider_code,))
        connection.commit()
        connection.close()
