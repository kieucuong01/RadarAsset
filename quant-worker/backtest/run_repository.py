from __future__ import annotations

import json
import os
import socket
import uuid
from datetime import timezone
from decimal import Decimal
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg.rows import dict_row

from backtest.models import Bar
from backtest.run_contracts import DatasetInput, QueuedRun, QueuedRunLeg


DEFAULT_DATABASE_URL = (
    "postgresql://postgres:postgres@localhost:5432/quant_insight_radar?schema=public"
)
DEFAULT_LEASE_SECONDS = 300
MAX_ATTEMPTS = 3


def load_local_env(path: str = ".env.local") -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def database_url() -> str:
    load_local_env()
    raw_url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
    parts = urlsplit(raw_url)
    query = urlencode([(key, value) for key, value in parse_qsl(parts.query) if key != "schema"])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


class PostgresWorkerRepository:
    def __init__(
        self,
        connection: psycopg.Connection[Any],
        *,
        worker_id: str | None = None,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
    ) -> None:
        if lease_seconds < 1:
            raise ValueError("Worker lease seconds must be positive.")
        self.connection = connection
        self.worker_id = worker_id or os.getenv(
            "QUANT_WORKER_ID", f"{socket.gethostname()}-{uuid.uuid4().hex[:12]}"
        )
        self.lease_seconds = lease_seconds

    def recover_stale_runs(self) -> int:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE quant_runs
                SET status = 'cancelled', progress = 100, finished_at = clock_timestamp(),
                    lease_expires_at = NULL
                WHERE status = 'cancel_requested'
                  AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
                """
            )
            recovered = cursor.rowcount
            cursor.execute(
                """
                UPDATE quant_runs
                SET status = 'timed_out', progress = 100, finished_at = clock_timestamp(),
                    error_message = 'ENGINE_TIMEOUT: Backtest execution timed out.',
                    lease_expires_at = NULL
                WHERE (
                    status = 'queued' AND deadline_at IS NOT NULL
                    AND deadline_at <= clock_timestamp()
                  ) OR (
                    status = 'running' AND (
                      (deadline_at IS NOT NULL AND deadline_at <= clock_timestamp())
                      OR (
                        lease_expires_at IS NOT NULL
                        AND lease_expires_at <= clock_timestamp()
                        AND attempt_count >= %s
                      )
                    )
                  )
                """,
                (MAX_ATTEMPTS,),
            )
            recovered += cursor.rowcount
            cursor.execute(
                """
                UPDATE quant_run_legs AS leg
                SET status = run.status, progress = 100,
                    error_code = CASE WHEN run.status = 'timed_out' THEN 'ENGINE_TIMEOUT' ELSE NULL END
                FROM quant_runs AS run
                WHERE leg.quant_run_id = run.id
                  AND run.status IN ('cancelled', 'timed_out')
                  AND leg.status IN ('queued', 'running')
                """
            )
        self.connection.commit()
        return recovered

    def claim_next_run(self) -> QueuedRun | None:
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                WITH next_run AS (
                  SELECT id
                  FROM quant_runs
                  WHERE (
                    (
                      status = 'queued'
                      AND (deadline_at IS NULL OR deadline_at > clock_timestamp())
                    )
                    OR (
                      status = 'running'
                      AND lease_expires_at IS NOT NULL
                      AND lease_expires_at <= clock_timestamp()
                      AND attempt_count < %s
                      AND (deadline_at IS NULL OR deadline_at > clock_timestamp())
                    )
                  )
                  AND (
                    strategy_version_id IS NOT NULL
                    OR strategy_name = 'MA Crossover Backtest'
                    OR EXISTS (
                      SELECT 1 FROM quant_run_legs AS leg WHERE leg.quant_run_id = quant_runs.id
                    )
                  )
                  ORDER BY created_at ASC
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
                )
                UPDATE quant_runs AS run
                SET status = 'running',
                    progress = GREATEST(progress, 5),
                    started_at = COALESCE(started_at, NOW()),
                    error_message = NULL,
                    worker_id = %s,
                    lease_expires_at = clock_timestamp() + (%s * INTERVAL '1 second'),
                    last_heartbeat_at = clock_timestamp(),
                    attempt_count = attempt_count + 1
                FROM next_run
                WHERE run.id = next_run.id
                RETURNING run.id, run.organization_id, run.strategy_hash,
                          run.parameters, run.dataset_version_ids,
                          run.worker_id, run.attempt_count, run.deadline_at
                """
                ,
                (MAX_ATTEMPTS, self.worker_id, self.lease_seconds),
            )
            row = cursor.fetchone()
        if row is None:
            return None
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT leg.id, asset.symbol, asset.market, leg.dataset_version_id,
                       leg.allocation_bps, leg.initial_notional, leg.leverage,
                       strategy.code AS strategy_code, strategy.version AS strategy_version,
                       leg.parameters, leg.implementation_hash
                FROM quant_run_legs AS leg
                JOIN assets AS asset ON asset.id = leg.asset_id
                JOIN strategy_versions AS strategy ON strategy.id = leg.strategy_version_id
                WHERE leg.quant_run_id = %s
                ORDER BY asset.symbol ASC
                """,
                (row["id"],),
            )
            leg_rows = cursor.fetchall()
        queued = QueuedRun(
            id=str(row["id"]),
            organization_id=str(row["organization_id"]),
            strategy_hash=str(row["strategy_hash"] or ""),
            parameters=dict(row["parameters"] or {}),
            dataset_version_ids=tuple(str(value) for value in (row["dataset_version_ids"] or [])),
            worker_id=str(row["worker_id"] or ""),
            attempt_count=int(row["attempt_count"] or 0),
            deadline_at=row["deadline_at"],
            legs=tuple(
                QueuedRunLeg(
                    id=str(leg["id"]),
                    asset=str(leg["symbol"]),
                    market=str(leg["market"]),
                    dataset_version_id=str(leg["dataset_version_id"]),
                    allocation_bps=int(leg["allocation_bps"]),
                    initial_notional=Decimal(str(leg["initial_notional"])),
                    leverage=Decimal(str(leg["leverage"])),
                    strategy_code=str(leg["strategy_code"]),
                    strategy_version=str(leg["strategy_version"]),
                    strategy_parameters=dict(leg["parameters"] or {}),
                    implementation_hash=str(leg["implementation_hash"] or ""),
                )
                for leg in leg_rows
            ),
        )
        self.connection.commit()
        return queued

    def checkpoint_run(self, run: QueuedRun, progress: int) -> str:
        bounded_progress = min(99, max(5, int(progress)))
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE quant_runs
                SET status = 'cancelled', progress = 100,
                    finished_at = clock_timestamp(), lease_expires_at = NULL
                WHERE id = %s AND organization_id = %s
                  AND status = 'cancel_requested' AND worker_id = %s
                RETURNING id
                """,
                (run.id, run.organization_id, run.worker_id),
            )
            if cursor.fetchone() is not None:
                cursor.execute(
                    """
                    UPDATE quant_run_legs SET status = 'cancelled', progress = 100
                    WHERE quant_run_id = %s AND status IN ('queued', 'running')
                    """,
                    (run.id,),
                )
                self.connection.commit()
                return "cancelled"
            cursor.execute(
                """
                UPDATE quant_runs
                SET status = 'timed_out', progress = 100,
                    error_message = 'ENGINE_TIMEOUT: Backtest execution timed out.',
                    finished_at = clock_timestamp(), lease_expires_at = NULL
                WHERE id = %s AND organization_id = %s AND status = 'running'
                  AND worker_id = %s AND deadline_at IS NOT NULL
                  AND deadline_at <= clock_timestamp()
                RETURNING id
                """,
                (run.id, run.organization_id, run.worker_id),
            )
            if cursor.fetchone() is not None:
                cursor.execute(
                    """
                    UPDATE quant_run_legs
                    SET status = 'timed_out', progress = 100, error_code = 'ENGINE_TIMEOUT'
                    WHERE quant_run_id = %s AND status IN ('queued', 'running')
                    """,
                    (run.id,),
                )
                self.connection.commit()
                return "timed_out"
            cursor.execute(
                """
                UPDATE quant_runs
                SET progress = GREATEST(progress, %s),
                    last_heartbeat_at = clock_timestamp(),
                    lease_expires_at = clock_timestamp() + (%s * INTERVAL '1 second')
                WHERE id = %s AND organization_id = %s AND status = 'running'
                  AND worker_id = %s
                RETURNING id
                """,
                (
                    bounded_progress,
                    self.lease_seconds,
                    run.id,
                    run.organization_id,
                    run.worker_id,
                ),
            )
            active = cursor.fetchone() is not None
            if active:
                cursor.execute(
                    """
                    UPDATE quant_run_legs
                    SET status = 'running', progress = GREATEST(progress, %s)
                    WHERE quant_run_id = %s AND status IN ('queued', 'running')
                    """,
                    (bounded_progress, run.id),
                )
        self.connection.commit()
        return "running" if active else "lease_lost"

    def load_datasets(self, run: QueuedRun) -> list[DatasetInput]:
        if not run.dataset_version_ids:
            return []
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT version.id AS version_id, version.checksum,
                       asset.symbol, asset.market,
                       bar.ts, bar.open, bar.high, bar.low, bar.close, bar.volume,
                       bar.source, dataset.timeframe, dataset.adjustment_policy
                FROM dataset_versions AS version
                JOIN datasets AS dataset ON dataset.id = version.dataset_id
                JOIN assets AS asset ON asset.id = dataset.asset_id
                JOIN dataset_bars AS bar ON bar.dataset_version_id = version.id
                WHERE version.id = ANY(%s::uuid[])
                ORDER BY asset.symbol ASC, bar.ts ASC
                """,
                (list(run.dataset_version_ids),),
            )
            rows = cursor.fetchall()
        self.connection.commit()
        grouped: dict[str, DatasetInput] = {}
        for row in rows:
            version_id = str(row["version_id"])
            bar = Bar(
                asset=str(row["symbol"]),
                timestamp=row["ts"].replace(tzinfo=row["ts"].tzinfo or timezone.utc),
                timeframe=str(row["timeframe"]),
                open=Decimal(str(row["open"])),
                high=Decimal(str(row["high"])),
                low=Decimal(str(row["low"])),
                close=Decimal(str(row["close"])),
                volume=None if row["volume"] is None else Decimal(str(row["volume"])),
                source=str(row["source"]),
            )
            existing = grouped.get(version_id)
            if existing is None:
                grouped[version_id] = DatasetInput(
                    version_id=version_id,
                    asset=str(row["symbol"]),
                    market=str(row["market"]),
                    checksum=str(row["checksum"]),
                    bars=[bar],
                    adjustment_policy=str(row["adjustment_policy"]),
                )
            else:
                existing.bars.append(bar)
        return [grouped[version_id] for version_id in run.dataset_version_ids if version_id in grouped]

    def complete_run(
        self,
        run: QueuedRun,
        summary: dict[str, Any],
        artifacts: list[dict[str, Any]],
    ) -> bool:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE quant_runs
                SET status = 'succeeded', progress = 100, metrics = %s::jsonb,
                    error_message = NULL, finished_at = clock_timestamp(), lease_expires_at = NULL
                WHERE id = %s AND organization_id = %s AND status = 'running'
                  AND worker_id = %s
                RETURNING id
                """,
                (
                    json.dumps(summary, separators=(",", ":")),
                    run.id,
                    run.organization_id,
                    run.worker_id,
                ),
            )
            if cursor.fetchone() is None:
                self.connection.rollback()
                return False
            cursor.execute(
                "DELETE FROM quant_run_artifacts WHERE quant_run_id = %s AND organization_id = %s",
                (run.id, run.organization_id),
            )
            for artifact in artifacts:
                leg_id = artifact.get("quantRunLegId")
                metrics = artifact.get("metrics")
                if leg_id is not None and metrics is not None:
                    cursor.execute(
                        """
                        UPDATE quant_run_legs
                        SET status = 'succeeded', progress = 100, metrics = %s::jsonb,
                            error_code = NULL
                        WHERE id = %s AND quant_run_id = %s
                        """,
                        (json.dumps(metrics, separators=(",", ":")), leg_id, run.id),
                    )
            for artifact in artifacts:
                cursor.execute(
                    """
                    INSERT INTO quant_run_artifacts (
                        id, organization_id, quant_run_id, quant_run_leg_id,
                        scope_key, kind, checksum, payload, row_count,
                        schema_version, created_at
                    ) VALUES (
                        gen_random_uuid(), %s, %s, %s, %s, %s, %s,
                        %s::jsonb, %s, %s, NOW()
                    )
                    """,
                    (
                        run.organization_id,
                        run.id,
                        artifact.get("quantRunLegId"),
                        artifact.get("scopeKey", "aggregate"),
                        artifact["kind"],
                        artifact["checksum"],
                        json.dumps(artifact["payload"], separators=(",", ":")),
                        artifact["rowCount"],
                        artifact["schemaVersion"],
                    ),
                )
        self.connection.commit()
        return True

    def fail_run(self, run: QueuedRun, code: str, message: str) -> bool:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE quant_runs
                SET status = 'failed', progress = 100, error_message = %s,
                    finished_at = clock_timestamp(), lease_expires_at = NULL
                WHERE id = %s AND organization_id = %s AND status = 'running'
                  AND worker_id = %s
                RETURNING id
                """,
                (f"{code}: {message}", run.id, run.organization_id, run.worker_id),
            )
            if cursor.fetchone() is None:
                self.connection.rollback()
                return False
            cursor.execute(
                """
                UPDATE quant_run_legs
                SET status = 'failed', progress = 100, error_code = %s
                WHERE quant_run_id = %s AND status IN ('queued', 'running')
                """,
                (code, run.id),
            )
        self.connection.commit()
        return True
