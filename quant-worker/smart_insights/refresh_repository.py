from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from psycopg.rows import dict_row


MAX_ATTEMPTS = 3


@dataclass(frozen=True, slots=True)
class QueuedBriefingRefresh:
    id: str
    organization_id: str
    user_id: str
    processing_version: int
    attempt_count: int


class PostgresBriefingRefreshRepository:
    def __init__(self, connection: Any, *, worker_id: str) -> None:
        self.connection = connection
        self.worker_id = worker_id

    def claim_next_request(self) -> QueuedBriefingRefresh | None:
        with self.connection.transaction():
            with self.connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    WITH candidate AS (
                      SELECT id
                      FROM smart_insight_refresh_requests
                      WHERE status = 'queued'
                        AND available_at <= NOW()
                        AND attempt_count < %s
                      ORDER BY requested_at ASC
                      FOR UPDATE SKIP LOCKED
                      LIMIT 1
                    )
                    UPDATE smart_insight_refresh_requests AS request
                    SET status = 'running',
                        processing_version = request.request_version,
                        started_at = NOW(),
                        finished_at = NULL,
                        worker_id = %s,
                        attempt_count = request.attempt_count + 1,
                        error_code = NULL,
                        updated_at = NOW()
                    FROM candidate
                    WHERE request.id = candidate.id
                    RETURNING request.id, request.organization_id, request.user_id,
                              request.processing_version, request.attempt_count
                    """,
                    (MAX_ATTEMPTS, self.worker_id),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        return QueuedBriefingRefresh(
            id=str(row["id"]),
            organization_id=str(row["organization_id"]),
            user_id=str(row["user_id"]),
            processing_version=int(row["processing_version"]),
            attempt_count=int(row["attempt_count"]),
        )

    def complete_request(self, request: QueuedBriefingRefresh) -> None:
        with self.connection.transaction():
            with self.connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE smart_insight_refresh_requests
                    SET status = CASE
                          WHEN request_version > processing_version THEN 'queued'
                          ELSE 'succeeded'
                        END,
                        available_at = CASE
                          WHEN request_version > processing_version THEN NOW()
                          ELSE available_at
                        END,
                        finished_at = CASE
                          WHEN request_version > processing_version THEN NULL
                          ELSE NOW()
                        END,
                        processing_version = CASE
                          WHEN request_version > processing_version THEN NULL
                          ELSE processing_version
                        END,
                        attempt_count = CASE
                          WHEN request_version > processing_version THEN 0
                          ELSE attempt_count
                        END,
                        worker_id = NULL,
                        error_code = NULL,
                        updated_at = NOW()
                    WHERE id = %s AND status = 'running' AND worker_id = %s
                    """,
                    (request.id, self.worker_id),
                )

    def retry_or_fail(self, request: QueuedBriefingRefresh, code: str) -> None:
        terminal = request.attempt_count >= MAX_ATTEMPTS
        delay_seconds = min(30, 2 ** max(0, request.attempt_count - 1))
        with self.connection.transaction():
            with self.connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE smart_insight_refresh_requests
                    SET status = %s,
                        available_at = CASE
                          WHEN %s THEN available_at
                          ELSE NOW() + make_interval(secs => %s)
                        END,
                        finished_at = CASE WHEN %s THEN NOW() ELSE NULL END,
                        worker_id = NULL,
                        processing_version = NULL,
                        error_code = %s,
                        updated_at = NOW()
                    WHERE id = %s AND status = 'running' AND worker_id = %s
                    """,
                    (
                        "failed" if terminal else "queued",
                        terminal,
                        delay_seconds,
                        terminal,
                        code,
                        request.id,
                        self.worker_id,
                    ),
                )
