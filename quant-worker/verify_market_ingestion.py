from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence
from uuid import UUID

import psycopg
from psycopg.rows import dict_row

from ingest_market_data import load_database_url, psycopg_connection_url


class SchedulerAlreadyRunning(RuntimeError):
    def __init__(self, run_id: str) -> None:
        super().__init__("Scheduler command is already running.")
        self.run_id = run_id


HEALTH_SQL = """
WITH expected AS (
  SELECT DISTINCT ON (instrument.asset_id, timeframe.timeframe)
         instrument.asset_id, timeframe.timeframe
FROM provider_instruments instrument
  JOIN data_providers provider ON provider.id = instrument.provider_id
  JOIN assets asset ON asset.id = instrument.asset_id
  CROSS JOIN (VALUES ('1d'), ('1h')) AS timeframe(timeframe)
  WHERE instrument.is_active = true AND provider.status = 'active'
    AND NOT (asset.market = 'metal_spot' AND timeframe.timeframe = '1h')
), active_versions AS (
  SELECT DISTINCT ON (dataset.asset_id, dataset.timeframe)
         dataset.asset_id, dataset.timeframe, version.coverage_end,
         version.missing_bar_count
  FROM datasets dataset
  JOIN dataset_versions version ON version.dataset_id = dataset.id
  WHERE dataset.adjustment_policy = 'raw' AND version.is_active = true
    AND version.quality_status IN ('passed', 'warning')
  ORDER BY dataset.asset_id, dataset.timeframe, version.published_at DESC
), backlog AS (
  SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest_at
  FROM market_ingestion_requests
  WHERE status IN ('queued', 'running')
), failures AS (
  SELECT COUNT(*)::int AS count
  FROM market_ingestion_requests
  WHERE status = 'failed' AND updated_at >= NOW() - INTERVAL '24 hours'
), worker AS (
  SELECT MAX(heartbeat_at) AS heartbeat_at
  FROM ingestion_worker_heartbeats
)
SELECT
  COUNT(*) FILTER (WHERE active.asset_id IS NULL)::int AS missing_dataset_count,
  COUNT(*) FILTER (
    WHERE active.asset_id IS NOT NULL AND active.coverage_end <
      CASE WHEN expected.timeframe = '1h'
        THEN NOW() - INTERVAL '3 hours'
        ELSE NOW() - INTERVAL '3 days'
      END
  )::int AS stale_dataset_count,
  COALESCE(SUM(active.missing_bar_count), 0)::bigint AS missing_bar_count,
  backlog.count AS backlog_count,
  backlog.count AS due_backlog_count,
  backlog.oldest_at AS oldest_backlog_at,
  backlog.oldest_at AS oldest_due_backlog_at,
  failures.count AS recent_provider_failure_count,
  worker.heartbeat_at AS worker_heartbeat_at,
  (SELECT MAX(finished_at) FROM market_ingestion_scheduler_runs WHERE status = 'succeeded')
    AS last_scheduler_success_at
FROM expected
LEFT JOIN active_versions active
  ON active.asset_id = expected.asset_id AND active.timeframe = expected.timeframe
CROSS JOIN backlog
CROSS JOIN failures
CROSS JOIN worker
GROUP BY backlog.count, backlog.oldest_at, failures.count, worker.heartbeat_at
"""


def load_health(connection: Any) -> dict[str, Any]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(HEALTH_SQL)
        row = cursor.fetchone()
    if row is None:
        raise RuntimeError("Market ingestion health query returned no result.")
    return dict(row)


def recover_stale_scheduler_runs(connection: Any, *, maximum_age_minutes: int = 180) -> int:
    if not 1 <= maximum_age_minutes <= 1440:
        raise ValueError("Scheduler recovery age is invalid.")
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE market_ingestion_scheduler_runs
            SET status = 'failed', finished_at = NOW(), error_code = 'scheduler_abandoned'
            WHERE status = 'running'
              AND started_at < NOW() - (%s * INTERVAL '1 minute')
            """,
            (maximum_age_minutes,),
        )
        recovered = cursor.rowcount
    connection.commit()
    return recovered


def start_scheduler_run(connection: Any, command: str) -> str:
    recover_stale_scheduler_runs(connection)
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
            (f"market-ingestion:{command}",),
        )
        cursor.execute(
            """
            SELECT id FROM market_ingestion_scheduler_runs
            WHERE command = %s AND status = 'running'
            ORDER BY started_at DESC LIMIT 1
            """,
            (command,),
        )
        active = cursor.fetchone()
        if active is not None:
            raise SchedulerAlreadyRunning(str(active["id"]))
        cursor.execute(
            """
            INSERT INTO market_ingestion_scheduler_runs (
              id, command, scheduled_at, started_at, status
            ) VALUES (gen_random_uuid(), %s, NOW(), NOW(), 'running')
            RETURNING id
            """,
            (command,),
        )
        row = cursor.fetchone()
    connection.commit()
    if row is None:
        raise RuntimeError("Scheduler run was not created.")
    return str(row["id"])


def finish_scheduler_run(
    connection: Any,
    run_id: str,
    status: str,
    *,
    queued_count: int = 0,
    retried_count: int = 0,
    processed_count: int = 0,
    failed_count: int = 0,
    error_code: str | None = None,
) -> None:
    UUID(run_id)
    counts = (queued_count, retried_count, processed_count, failed_count)
    if any(value < 0 for value in counts):
        raise ValueError("Scheduler counts must be non-negative.")
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE market_ingestion_scheduler_runs
            SET status = %s, finished_at = NOW(), queued_count = %s,
                retried_count = %s, processed_count = %s, failed_count = %s,
                error_code = %s
            WHERE id = %s AND status = 'running'
            """,
            (status, queued_count, retried_count, processed_count, failed_count, error_code, run_id),
        )
        if cursor.rowcount != 1:
            raise RuntimeError("Scheduler run is not active.")
    connection.commit()


def verify_health(
    row: dict[str, Any],
    *,
    maximum_backlog_age_hours: int,
    maximum_recent_failures: int,
    now: datetime | None = None,
) -> list[str]:
    del maximum_recent_failures
    errors: list[str] = []
    if int(row["missing_dataset_count"]) > 0:
        errors.append("missing_datasets")
    if int(row["stale_dataset_count"]) > 0:
        errors.append("stale_datasets")
    checked_at = now or datetime.now(timezone.utc)
    heartbeat = row.get("worker_heartbeat_at")
    if int(row.get("due_backlog_count", 0)) > 0 and (
        heartbeat is None or (checked_at - heartbeat).total_seconds() > 90
    ):
        errors.append("worker_stale")
    oldest = row.get("oldest_backlog_at")
    if oldest is not None:
        age_hours = (checked_at - oldest).total_seconds() / 3600
        if age_hours > maximum_backlog_age_hours:
            errors.append("backlog_too_old")
    return errors


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify production market ingestion health.")
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--maximum-backlog-age-hours", type=int, default=6)
    parser.add_argument("--maximum-recent-failures", type=int, default=0)
    parser.add_argument("--start-command", choices=("all", "hourly", "daily"))
    parser.add_argument("--finish-run")
    parser.add_argument("--finish-status", choices=("succeeded", "failed"))
    parser.add_argument("--queued-count", type=int, default=0)
    parser.add_argument("--retried-count", type=int, default=0)
    parser.add_argument("--processed-count", type=int, default=0)
    parser.add_argument("--failed-count", type=int, default=0)
    parser.add_argument("--error-code")
    args = parser.parse_args(argv)
    if not 1 <= args.maximum_backlog_age_hours <= 168 or not 0 <= args.maximum_recent_failures <= 10_000:
        print(json.dumps({"status": "failed", "errorCode": "configuration_error"}))
        return 2
    try:
        url = psycopg_connection_url(load_database_url(Path(args.env_file)))
        with psycopg.connect(url) as connection:
            if args.start_command:
                run_id = start_scheduler_run(connection, args.start_command)
                print(json.dumps({"status": "running", "runId": run_id}))
                return 0
            if args.finish_run:
                if not args.finish_status:
                    raise ValueError("--finish-status is required with --finish-run.")
                finish_scheduler_run(
                    connection,
                    args.finish_run,
                    args.finish_status,
                    queued_count=args.queued_count,
                    retried_count=args.retried_count,
                    processed_count=args.processed_count,
                    failed_count=args.failed_count,
                    error_code=args.error_code,
                )
                print(json.dumps({"status": args.finish_status, "runId": args.finish_run}))
                return 0
            health = load_health(connection)
        errors = verify_health(
            health,
            maximum_backlog_age_hours=args.maximum_backlog_age_hours,
            maximum_recent_failures=args.maximum_recent_failures,
        )
        output = {
            **health,
            "oldest_backlog_at": health["oldest_backlog_at"].isoformat()
            if health["oldest_backlog_at"]
            else None,
            "last_scheduler_success_at": health["last_scheduler_success_at"].isoformat()
            if health["last_scheduler_success_at"]
            else None,
            "worker_heartbeat_at": health["worker_heartbeat_at"].isoformat()
            if health["worker_heartbeat_at"]
            else None,
            "status": "succeeded" if not errors else "failed",
            "errors": errors,
        }
        print(json.dumps(output, separators=(",", ":")))
        return 0 if not errors else 1
    except SchedulerAlreadyRunning as error:
        print(json.dumps({"status": "already_running", "runId": error.run_id}))
        return 3
    except (OSError, ValueError, psycopg.Error):
        print(json.dumps({"status": "failed", "errorCode": "verification_failed"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
