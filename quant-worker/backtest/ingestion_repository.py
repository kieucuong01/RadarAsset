from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

import psycopg
from psycopg.rows import dict_row

from .catalog import FEEDS
from .ingestion import IngestionSelection
from .publication import (
    PostgresDatasetPublisher,
    PreparedDatasetPublication,
    PublicationResult,
)
from .snapshots import ActiveSnapshot


TERMINAL_ERROR_STATUSES = {"failed", "unavailable"}
STABLE_ERROR_CODES = {
    "ingestion_failed",
    "invalid_response",
    "network_error",
    "provider_rejected",
    "provider_unavailable",
    "rate_limited",
    "response_limit",
    "stale_run",
}


class PostgresIngestionRepository:
    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        if not connection.autocommit:
            raise ValueError("Ingestion repository requires an autocommit connection.")
        self.connection = connection
        self.publisher = PostgresDatasetPublisher(connection)

    @staticmethod
    def _lock_key(selection: IngestionSelection) -> str:
        feed = FEEDS[selection.asset]
        return (
            f"market-ingestion:{feed.provider_code}:"
            f"{selection.asset}:{selection.timeframe}"
        )

    def try_lock(self, selection: IngestionSelection) -> bool:
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS acquired",
                (self._lock_key(selection),),
            )
            row = cursor.fetchone()
        return bool(row and row["acquired"])

    def unlock(self, selection: IngestionSelection) -> None:
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "SELECT pg_advisory_unlock(hashtextextended(%s, 0)) AS released",
                (self._lock_key(selection),),
            )
            row = cursor.fetchone()
        if not row or not row["released"]:
            raise RuntimeError("Ingestion advisory lock was not held.")

    def fail_stale_runs(self, now: datetime) -> int:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE market_ingestion_runs
                SET status = 'failed',
                    finished_at = %s,
                    error_code = 'stale_run',
                    error_message = 'Market ingestion run exceeded its time limit.'
                WHERE status = 'running'
                  AND started_at < %s
                """,
                (now, now - timedelta(hours=2)),
            )
            return cursor.rowcount

    def record_skipped(
        self,
        selection: IngestionSelection,
        scheduled_at: datetime,
        reason: str,
    ) -> None:
        feed = FEEDS[selection.asset]
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO market_ingestion_runs (
                    id, provider_code, asset_symbol, timeframe, scheduled_at,
                    started_at, finished_at, status, attempt_count,
                    fetched_row_count, metadata
                ) VALUES (
                    gen_random_uuid(), %s, %s, %s, %s,
                    %s, %s, 'skipped', 0, 0, %s::jsonb
                )
                """,
                (
                    feed.provider_code,
                    selection.asset,
                    selection.timeframe,
                    scheduled_at,
                    scheduled_at,
                    scheduled_at,
                    json.dumps({"reason": reason}, separators=(",", ":")),
                ),
            )

    def start_run(
        self, selection: IngestionSelection, scheduled_at: datetime
    ) -> str:
        feed = FEEDS[selection.asset]
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                INSERT INTO market_ingestion_runs (
                    id, provider_code, asset_symbol, timeframe, scheduled_at,
                    started_at, status, attempt_count, fetched_row_count, metadata
                ) VALUES (
                    gen_random_uuid(), %s, %s, %s, %s,
                    %s, 'running', 1, 0, '{}'::jsonb
                )
                RETURNING id
                """,
                (
                    feed.provider_code,
                    selection.asset,
                    selection.timeframe,
                    scheduled_at,
                    scheduled_at,
                ),
            )
            row = cursor.fetchone()
        if row is None:
            raise RuntimeError("Failed to create ingestion run.")
        return str(row["id"])

    def load_active(
        self, selection: IngestionSelection
    ) -> ActiveSnapshot | None:
        return self.publisher.load_active(selection.asset, selection.timeframe)

    def publish_and_finish(
        self,
        run_id: str,
        prepared: PreparedDatasetPublication,
        fetched_row_count: int,
    ) -> PublicationResult:
        with self.connection.transaction():
            result = self.publisher.publish_if_changed(prepared)
            with self.connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE market_ingestion_runs
                    SET status = %s,
                        finished_at = NOW(),
                        fetched_row_count = %s,
                        dataset_version_id = %s,
                        error_code = NULL,
                        error_message = NULL
                    WHERE id = %s
                      AND status = 'running'
                    """,
                    (
                        result.status,
                        fetched_row_count,
                        result.dataset_version_id,
                        run_id,
                    ),
                )
                if cursor.rowcount != 1:
                    raise RuntimeError("Expected one running ingestion row.")
        return result

    def finish_error(
        self,
        run_id: str,
        *,
        status: str,
        error_code: str,
        error_message: str,
    ) -> None:
        if status not in TERMINAL_ERROR_STATUSES:
            raise ValueError("Unsupported ingestion error status.")
        if error_code not in STABLE_ERROR_CODES:
            raise ValueError("Unsupported ingestion error code.")
        safe_message = error_message[:200]
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE market_ingestion_runs
                SET status = %s,
                    finished_at = NOW(),
                    error_code = %s,
                    error_message = %s
                WHERE id = %s
                  AND status = 'running'
                """,
                (status, error_code, safe_message, run_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Expected one running ingestion row.")
