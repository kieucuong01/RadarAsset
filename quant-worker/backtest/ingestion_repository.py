from __future__ import annotations

import json
import socket
import uuid
from dataclasses import dataclass
from decimal import Decimal
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
    "unsupported_timeframe",
}


@dataclass(frozen=True)
class QueuedIngestionRequest:
    id: str
    provider_code: str
    provider_name: str
    terms_url: str | None
    provider_symbol: str
    asset: str
    asset_name: str
    market: str
    venue: str | None
    currency: str
    timezone_name: str
    canonical_key: str
    maximum_leverage: Decimal
    timeframe: str
    worker_id: str
    attempt_count: int


class PostgresRequestRepository:
    def __init__(
        self,
        connection: psycopg.Connection[Any],
        *,
        worker_id: str | None = None,
        lease_seconds: int = 300,
    ) -> None:
        if not connection.autocommit:
            raise ValueError("Request repository requires an autocommit connection.")
        if lease_seconds < 1:
            raise ValueError("Request lease must be positive.")
        self.connection = connection
        self.worker_id = worker_id or f"{socket.gethostname()}-{uuid.uuid4().hex[:12]}"
        self.lease_seconds = lease_seconds
        self.publisher = PostgresDatasetPublisher(connection)

    def claim_next_request(self) -> QueuedIngestionRequest | None:
        with self.connection.transaction():
            with self.connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    WITH next_request AS (
                      SELECT request.id
                      FROM market_ingestion_requests AS request
                      WHERE (
                        (request.status = 'queued' AND request.available_at <= NOW())
                        OR (
                          request.status = 'running'
                          AND request.lease_expires_at <= NOW()
                          AND request.attempt_count < 3
                        )
                      )
                      ORDER BY request.available_at, request.created_at
                      FOR UPDATE SKIP LOCKED
                      LIMIT 1
                    )
                    UPDATE market_ingestion_requests AS request
                    SET status = 'running',
                        worker_id = %s,
                        lease_expires_at = NOW() + (%s * INTERVAL '1 second'),
                        attempt_count = request.attempt_count + 1,
                        error_code = NULL,
                        updated_at = NOW()
                    FROM next_request
                    WHERE request.id = next_request.id
                    RETURNING request.id, request.provider_instrument_id,
                              request.timeframe, request.worker_id, request.attempt_count
                    """,
                    (self.worker_id, self.lease_seconds),
                )
                claimed = cursor.fetchone()
                if claimed is None:
                    return None
                cursor.execute(
                    """
                    SELECT provider.code AS provider_code, provider.name AS provider_name,
                           provider.terms_url, instrument.provider_symbol,
                           asset.symbol, asset.name AS asset_name, asset.market, asset.venue,
                           asset.currency, asset.timezone, asset.canonical_key,
                           asset.max_leverage
                    FROM provider_instruments AS instrument
                    JOIN data_providers AS provider ON provider.id = instrument.provider_id
                    JOIN assets AS asset ON asset.id = instrument.asset_id
                    WHERE instrument.id = %s
                    """,
                    (claimed["provider_instrument_id"],),
                )
                metadata = cursor.fetchone()
                if metadata is None:
                    raise RuntimeError("Claimed provider instrument is unavailable.")
        return QueuedIngestionRequest(
            id=str(claimed["id"]),
            provider_code=str(metadata["provider_code"]),
            provider_name=str(metadata["provider_name"]),
            terms_url=None if metadata["terms_url"] is None else str(metadata["terms_url"]),
            provider_symbol=str(metadata["provider_symbol"]),
            asset=str(metadata["symbol"]),
            asset_name=str(metadata["asset_name"]),
            market=str(metadata["market"]),
            venue=None if metadata["venue"] is None else str(metadata["venue"]),
            currency=str(metadata["currency"]),
            timezone_name=str(metadata["timezone"]),
            canonical_key=str(metadata["canonical_key"] or f"{metadata['market']}:{metadata['symbol']}"),
            maximum_leverage=Decimal(str(metadata["max_leverage"])),
            timeframe=str(claimed["timeframe"]),
            worker_id=str(claimed["worker_id"]),
            attempt_count=int(claimed["attempt_count"]),
        )

    def load_active(self, request: QueuedIngestionRequest) -> ActiveSnapshot | None:
        return self.publisher.load_active(request.asset, request.timeframe)

    def publish(
        self, request: QueuedIngestionRequest, prepared: PreparedDatasetPublication
    ) -> PublicationResult:
        del request
        with self.connection.transaction():
            return self.publisher.publish_if_changed(prepared)

    def complete_request(self, request: QueuedIngestionRequest, dataset_version_id: str) -> None:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE market_ingestion_requests
                SET status = 'succeeded', dataset_version_id = %s,
                    lease_expires_at = NULL, error_code = NULL, updated_at = NOW()
                WHERE id = %s AND status = 'running' AND worker_id = %s
                  AND lease_expires_at > NOW()
                """,
                (dataset_version_id, request.id, request.worker_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Ingestion request lease is no longer active.")

    def retry_or_fail(self, request: QueuedIngestionRequest, code: str) -> None:
        terminal = request.attempt_count >= 3
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE market_ingestion_requests
                SET status = %s,
                    available_at = CASE WHEN %s THEN available_at ELSE NOW() + (%s * INTERVAL '1 minute') END,
                    worker_id = NULL, lease_expires_at = NULL,
                    error_code = %s, updated_at = NOW()
                WHERE id = %s AND status = 'running' AND worker_id = %s
                """,
                (
                    "failed" if terminal else "queued",
                    terminal,
                    min(15, 2 ** max(0, request.attempt_count - 1)),
                    code,
                    request.id,
                    request.worker_id,
                ),
            )

    def fail_request(self, request: QueuedIngestionRequest, code: str) -> None:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE market_ingestion_requests
                SET status = 'failed', worker_id = NULL, lease_expires_at = NULL,
                    error_code = %s, updated_at = NOW()
                WHERE id = %s AND status = 'running' AND worker_id = %s
                """,
                (code, request.id, request.worker_id),
            )

    def requeue_failed_requests(
        self,
        *,
        limit: int,
        error_code: str | None = None,
        provider_code: str | None = None,
    ) -> int:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                WITH candidates AS (
                  SELECT DISTINCT ON (
                    request.organization_id, request.user_id,
                    request.provider_instrument_id, request.timeframe
                  ) request.id, request.updated_at
                  FROM market_ingestion_requests request
                  JOIN provider_instruments instrument
                    ON instrument.id = request.provider_instrument_id
                  JOIN data_providers provider ON provider.id = instrument.provider_id
                  WHERE request.status = 'failed'
                    AND (%s::text IS NULL OR request.error_code = %s::text)
                    AND (%s::text IS NULL OR provider.code = %s::text)
                    AND NOT EXISTS (
                      SELECT 1
                      FROM market_ingestion_requests active_request
                      WHERE active_request.organization_id = request.organization_id
                        AND active_request.user_id = request.user_id
                        AND active_request.provider_instrument_id = request.provider_instrument_id
                        AND active_request.timeframe = request.timeframe
                        AND active_request.status IN ('queued', 'running')
                    )
                    AND NOT EXISTS (
                      SELECT 1
                      FROM datasets dataset
                      JOIN dataset_versions version
                        ON version.dataset_id = dataset.id
                       AND version.is_active
                      WHERE dataset.asset_id = instrument.asset_id
                        AND dataset.timeframe = request.timeframe
                        AND dataset.adjustment_policy = 'raw'
                    )
                  ORDER BY request.organization_id, request.user_id,
                           request.provider_instrument_id, request.timeframe,
                           request.updated_at DESC, request.id DESC
                ),
                selected AS (
                  SELECT id FROM candidates
                  ORDER BY updated_at ASC, id ASC
                  LIMIT %s
                  FOR UPDATE SKIP LOCKED
                )
                UPDATE market_ingestion_requests request
                SET status = 'queued', available_at = NOW(), attempt_count = 0,
                    worker_id = NULL, lease_expires_at = NULL,
                    error_code = NULL, updated_at = NOW()
                FROM selected
                WHERE request.id = selected.id
                """,
                (error_code, error_code, provider_code, provider_code, limit),
            )
            return cursor.rowcount


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
