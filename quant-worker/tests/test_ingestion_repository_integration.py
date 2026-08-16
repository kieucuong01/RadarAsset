from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row
import pytest

from backtest.ingestion import IngestionSelection
from backtest.ingestion_repository import (
    PostgresIngestionRepository,
    PostgresRequestRepository,
    QueuedIngestionRequest,
)
from backtest.models import Bar
from backtest.publication import prepare_dataset_publication
from sync_provider_instruments import queue_market_ingestion_requests


def _test_database_url() -> str:
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests.")
    parts = urlsplit(raw_url)
    query = urlencode(
        [(key, value) for key, value in parse_qsl(parts.query) if key != "schema"]
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def test_market_ingestion_run_records_running_state() -> None:
    run_id = str(uuid4())
    with psycopg.connect(_test_database_url(), row_factory=dict_row) as connection:
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO market_ingestion_runs (
                        id, provider_code, asset_symbol, timeframe, scheduled_at,
                        started_at, status, attempt_count, fetched_row_count, metadata
                    ) VALUES (
                        %s, 'qa-provider', 'QA', '1h', NOW(), NOW(),
                        'running', 1, 0, '{}'::jsonb
                    )
                    RETURNING id, status, attempt_count, fetched_row_count
                    """,
                    (run_id,),
                )

                assert cursor.fetchone() == {
                    "id": UUID(run_id),
                    "status": "running",
                    "attempt_count": 1,
                    "fetched_row_count": 0,
                }
        finally:
            connection.rollback()
            with connection.cursor() as cursor:
                cursor.execute("SELECT to_regclass('market_ingestion_runs') AS table_name")
                if cursor.fetchone()["table_name"] is not None:
                    cursor.execute(
                        "DELETE FROM market_ingestion_runs WHERE id = %s", (run_id,)
                    )
            connection.commit()


def _prepared_dataset(symbol: str, provider_code: str):
    rows = [
        Bar(
            asset=symbol,
            timestamp=datetime(2026, 8, 10, hour, tzinfo=timezone.utc),
            timeframe="1h",
            open=Decimal("100"),
            high=Decimal("101"),
            low=Decimal("99"),
            close=Decimal("100"),
            volume=Decimal("10"),
            source="qa-ingestion-live",
        )
        for hour in range(3)
    ]
    return prepare_dataset_publication(
        rows,
        market="crypto_spot",
        provider_code=provider_code,
        provider_name="QA ingestion provider",
        provider_symbol=symbol,
        canonical_key=f"QA:INGESTION:{symbol}",
        asset_name="QA ingestion asset",
        currency="USD",
        venue="QA",
        timezone_name="UTC",
        maximum_leverage=Decimal("1"),
        terms_url=None,
        source_metadata={"mode": "live", "upstreamProvider": "qa"},
    )


def _cleanup(connection: psycopg.Connection, *, symbol: str, provider_code: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM assets WHERE symbol = %s", (symbol,))
        cursor.execute("DELETE FROM data_providers WHERE code = %s", (provider_code,))


def test_repository_advisory_lock_excludes_the_same_feed() -> None:
    selection = IngestionSelection("BTC", "1h")
    first_connection = psycopg.connect(_test_database_url(), autocommit=True)
    second_connection = psycopg.connect(_test_database_url(), autocommit=True)
    try:
        first = PostgresIngestionRepository(first_connection)
        second = PostgresIngestionRepository(second_connection)

        assert first.try_lock(selection) is True
        assert second.try_lock(selection) is False
        first.unlock(selection)
        assert second.try_lock(selection) is True
        second.unlock(selection)
    finally:
        first_connection.close()
        second_connection.close()


def test_publish_and_finish_commits_dataset_and_terminal_run_together() -> None:
    suffix = uuid4().hex[:8]
    symbol = f"QAIR{suffix}"
    provider_code = f"qa-ingestion-{suffix}"
    selection = IngestionSelection("BTC", "1h")
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    run_id: str | None = None
    try:
        repository = PostgresIngestionRepository(connection)
        run_id = repository.start_run(selection, datetime.now(timezone.utc))
        result = repository.publish_and_finish(
            run_id,
            _prepared_dataset(symbol, provider_code),
            fetched_row_count=3,
        )

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT status, fetched_row_count, dataset_version_id,
                       error_code, error_message
                FROM market_ingestion_runs
                WHERE id = %s
                """,
                (run_id,),
            )
            stored = cursor.fetchone()
        assert stored == {
            "status": "succeeded",
            "fetched_row_count": 3,
            "dataset_version_id": UUID(result.dataset_version_id),
            "error_code": None,
            "error_message": None,
        }
    finally:
        with connection.transaction():
            with connection.cursor() as cursor:
                if run_id is not None:
                    cursor.execute(
                        "DELETE FROM market_ingestion_runs WHERE id = %s", (run_id,)
                    )
            _cleanup(connection, symbol=symbol, provider_code=provider_code)
        connection.close()


def test_publish_and_finish_rolls_back_when_the_run_does_not_exist() -> None:
    suffix = uuid4().hex[:8]
    symbol = f"QARB{suffix}"
    provider_code = f"qa-rollback-{suffix}"
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        repository = PostgresIngestionRepository(connection)
        with pytest.raises(RuntimeError, match="running ingestion row"):
            repository.publish_and_finish(
                str(uuid4()),
                _prepared_dataset(symbol, provider_code),
                fetched_row_count=3,
            )

        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) AS count FROM assets WHERE symbol = %s", (symbol,))
            assert cursor.fetchone()["count"] == 0
            cursor.execute(
                "SELECT COUNT(*) AS count FROM data_providers WHERE code = %s",
                (provider_code,),
            )
            assert cursor.fetchone()["count"] == 0
    finally:
        with connection.transaction():
            _cleanup(connection, symbol=symbol, provider_code=provider_code)
        connection.close()


def test_fail_stale_runs_marks_only_expired_running_rows() -> None:
    now = datetime(2026, 8, 10, 12, tzinfo=timezone.utc)
    stale_id = str(uuid4())
    fresh_id = str(uuid4())
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO market_ingestion_runs (
                    id, provider_code, asset_symbol, timeframe, scheduled_at,
                    started_at, status, attempt_count, fetched_row_count, metadata
                ) VALUES
                    (%s, 'qa-stale', 'BTC', '1h', %s, %s, 'running', 1, 0, '{}'::jsonb),
                    (%s, 'qa-fresh', 'XAU', '1h', %s, %s, 'running', 1, 0, '{}'::jsonb)
                """,
                (
                    stale_id,
                    now - timedelta(hours=3),
                    now - timedelta(hours=3),
                    fresh_id,
                    now - timedelta(minutes=30),
                    now - timedelta(minutes=30),
                ),
            )
        repository = PostgresIngestionRepository(connection)

        assert repository.fail_stale_runs(now) == 1

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT provider_code, status, error_code
                FROM market_ingestion_runs
                WHERE id IN (%s, %s)
                ORDER BY provider_code
                """,
                (stale_id, fresh_id),
            )
            assert cursor.fetchall() == [
                {"provider_code": "qa-fresh", "status": "running", "error_code": None},
                {"provider_code": "qa-stale", "status": "failed", "error_code": "stale_run"},
            ]
    finally:
        with connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM market_ingestion_runs WHERE id IN (%s, %s)",
                (stale_id, fresh_id),
            )
        connection.close()


def test_request_worker_heartbeat_and_lease_renewal_round_trip() -> None:
    worker_id = f"qa-worker-{uuid4().hex[:8]}"
    request_id = str(uuid4())
    organization_id = str(uuid4())
    user_id = str(uuid4())
    provider_id = str(uuid4())
    asset_id = str(uuid4())
    instrument_id = str(uuid4())
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO app_users (id, email, name, created_at, updated_at) VALUES (%s, %s, 'QA', NOW(), NOW())",
                (user_id, f"{worker_id}@example.test"),
            )
            cursor.execute(
                "INSERT INTO organizations (id, name, slug, created_at) VALUES (%s, 'QA', %s, NOW())",
                (organization_id, worker_id),
            )
            cursor.execute(
                "INSERT INTO data_providers (id, code, name, status, created_at, updated_at) VALUES (%s, %s, 'QA', 'active', NOW(), NOW())",
                (provider_id, worker_id),
            )
            cursor.execute(
                """
                INSERT INTO assets (id, symbol, canonical_key, name, asset_class, market, timezone, currency, listing_status, created_at, updated_at)
                VALUES (%s, %s, %s, 'QA', 'crypto', 'crypto_spot', 'UTC', 'USD', 'active', NOW(), NOW())
                """,
                (asset_id, worker_id.upper(), f"QA:{worker_id}"),
            )
            cursor.execute(
                "INSERT INTO provider_instruments (id, provider_id, asset_id, provider_symbol, is_active, last_seen_at, created_at) VALUES (%s, %s, %s, %s, true, NOW(), NOW())",
                (instrument_id, provider_id, asset_id, worker_id.upper()),
            )
            cursor.execute(
                """
                INSERT INTO market_ingestion_requests (
                  id, organization_id, user_id, provider_instrument_id, timeframe,
                  status, attempt_count, available_at, worker_id, lease_expires_at,
                  created_at, updated_at
                ) VALUES (%s, %s, %s, %s, '1h', 'running', 1, NOW(), %s, NOW() + INTERVAL '10 seconds', NOW(), NOW())
                """,
                (request_id, organization_id, user_id, instrument_id, worker_id),
            )

        repository = PostgresRequestRepository(
            connection, worker_id=worker_id, lease_seconds=60
        )
        queued = QueuedIngestionRequest(
            id=request_id,
            provider_code=worker_id,
            provider_name="QA",
            terms_url=None,
            provider_symbol=worker_id.upper(),
            asset=worker_id.upper(),
            asset_name="QA",
            market="crypto_spot",
            venue=None,
            currency="USD",
            timezone_name="UTC",
            canonical_key=f"QA:{worker_id}",
            maximum_leverage=Decimal("1"),
            timeframe="1h",
            worker_id=worker_id,
            attempt_count=1,
        )

        repository.heartbeat(request_id)
        assert repository.renew_lease(queued) is True
        repository.heartbeat(None)

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT current_request_id, heartbeat_at >= started_at AS fresh FROM ingestion_worker_heartbeats WHERE worker_id = %s",
                (worker_id,),
            )
            assert cursor.fetchone() == {"current_request_id": None, "fresh": True}
    finally:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM ingestion_worker_heartbeats WHERE worker_id = %s", (worker_id,))
            cursor.execute("DELETE FROM market_ingestion_requests WHERE id = %s", (request_id,))
            cursor.execute("DELETE FROM provider_instruments WHERE id = %s", (instrument_id,))
            cursor.execute("DELETE FROM assets WHERE id = %s", (asset_id,))
            cursor.execute("DELETE FROM data_providers WHERE id = %s", (provider_id,))
            cursor.execute("DELETE FROM organizations WHERE id = %s", (organization_id,))
            cursor.execute("DELETE FROM app_users WHERE id = %s", (user_id,))
        connection.close()


def test_due_queue_skips_fresh_and_enqueues_stale_scoped_crypto_daily() -> None:
    suffix = uuid4().hex[:8]
    organization_id = str(uuid4())
    user_id = str(uuid4())
    asset_id = str(uuid4())
    instrument_id = str(uuid4())
    dataset_id = str(uuid4())
    version_id = str(uuid4())
    org_slug = f"qa-due-{suffix}"
    email = f"qa-due-{suffix}@example.test"
    now = datetime(2026, 8, 14, 9, 30, tzinfo=timezone.utc)
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM data_providers WHERE code = 'binance-public'"
            )
            provider = cursor.fetchone()
            if provider is None:
                pytest.skip("binance-public provider seed is required.")
            provider_id = str(provider["id"])
            cursor.execute(
                "INSERT INTO app_users (id, email, name, created_at, updated_at) VALUES (%s, %s, 'QA due', NOW(), NOW())",
                (user_id, email),
            )
            cursor.execute(
                "INSERT INTO organizations (id, name, slug, created_at) VALUES (%s, 'QA due', %s, NOW())",
                (organization_id, org_slug),
            )
            cursor.execute(
                """
                INSERT INTO assets (
                  id, symbol, canonical_key, name, asset_class, market, timezone,
                  currency, listing_status, created_at, updated_at
                ) VALUES (%s, %s, %s, 'QA due', 'crypto', 'crypto_spot', 'UTC',
                          'USDT', 'active', NOW(), NOW())
                """,
                (asset_id, f"QD{suffix}", f"QA:DUE:{suffix}"),
            )
            cursor.execute(
                """
                INSERT INTO provider_instruments (
                  id, provider_id, asset_id, provider_symbol, is_active,
                  last_seen_at, created_at
                ) VALUES (%s, %s, %s, %s, true, NOW(), NOW())
                """,
                (instrument_id, provider_id, asset_id, f"QD{suffix}USDT"),
            )
            cursor.execute(
                "INSERT INTO datasets (id, asset_id, timeframe, adjustment_policy, created_at) VALUES (%s, %s, '1d', 'raw', NOW())",
                (dataset_id, asset_id),
            )
            cursor.execute(
                """
                INSERT INTO dataset_versions (
                  id, dataset_id, provider_id, version, checksum, coverage_start,
                  coverage_end, row_count, is_active, published_at
                ) VALUES (%s, %s, %s, 1, %s, %s, %s, 1, true, NOW())
                """,
                (
                    version_id,
                    dataset_id,
                    provider_id,
                    f"qa-due-{suffix}",
                    now - timedelta(days=1),
                    datetime(2026, 8, 14, 8, tzinfo=timezone.utc),
                ),
            )

        assert queue_market_ingestion_requests(
            connection,
            command="daily",
            organization_slug=org_slug,
            user_email=email,
            now=now,
            allowed_symbols=(f"QD{suffix}",),
        ) >= 0
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) AS count FROM market_ingestion_requests WHERE organization_id = %s AND provider_instrument_id = %s",
                (organization_id, instrument_id),
            )
            assert cursor.fetchone()["count"] == 0
            cursor.execute(
                "UPDATE dataset_versions SET coverage_end = %s WHERE id = %s",
                (datetime(2026, 8, 11, 5, tzinfo=timezone.utc), version_id),
            )

        assert queue_market_ingestion_requests(
            connection,
            command="daily",
            organization_slug=org_slug,
            user_email=email,
            now=now,
            allowed_symbols=(f"QD{suffix}",),
        ) >= 1
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT status FROM market_ingestion_requests WHERE organization_id = %s AND provider_instrument_id = %s",
                (organization_id, instrument_id),
            )
            assert cursor.fetchone()["status"] == "queued"
    finally:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM organizations WHERE id = %s", (organization_id,))
            cursor.execute("DELETE FROM app_users WHERE id = %s", (user_id,))
            cursor.execute("DELETE FROM assets WHERE id = %s", (asset_id,))
        connection.close()
