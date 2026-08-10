from __future__ import annotations

import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row
import pytest


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
