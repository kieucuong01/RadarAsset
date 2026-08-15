from __future__ import annotations

import argparse
import json
import socket
import time
from collections.abc import Callable, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import psycopg

from ingest_market_data import load_database_url, psycopg_connection_url
from smart_insights.briefing_pipeline import PostgresBriefingRepository, generate_briefing
from smart_insights.refresh_repository import PostgresBriefingRefreshRepository
from smart_insights.refresh_worker import process_next_briefing_refresh


def process_refresh_backlog(
    repository: PostgresBriefingRefreshRepository,
    generate: Callable[..., object],
    *,
    watch: bool,
    limit: int,
    poll_seconds: float,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, int | str]:
    processed = failed = 0
    while watch or processed < limit:
        outcome = process_next_briefing_refresh(repository, generate=generate)
        if outcome["status"] == "idle":
            if not watch:
                break
            sleep(poll_seconds)
            continue
        processed += 1
        failed += outcome["status"] != "succeeded"
        print(json.dumps(outcome, separators=(",", ":"), sort_keys=True))
    return {
        "status": "succeeded" if failed == 0 else "partial_failure",
        "processed": processed,
        "failed": failed,
    }


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Process Smart Insights refresh requests.")
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--poll-seconds", type=float, default=5.0)
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    connection_factory: Callable[..., Any] = psycopg.connect,
) -> int:
    args = _argument_parser().parse_args(argv)
    if not 1 <= args.limit <= 500 or not 0.5 <= args.poll_seconds <= 60:
        print(json.dumps({"status": "fatal", "errorCode": "configuration_error"}))
        return 2
    try:
        database_url = psycopg_connection_url(load_database_url(Path(args.env_file)))
        worker_id = f"smart-insights-{socket.gethostname()}-{uuid4().hex[:8]}"
        with connection_factory(database_url, autocommit=True) as connection:
            refreshes = PostgresBriefingRefreshRepository(
                connection, worker_id=worker_id
            )
            briefings = PostgresBriefingRepository(connection)

            def generate(**kwargs: object) -> object:
                return generate_briefing(briefings, **kwargs)

            summary = process_refresh_backlog(
                refreshes,
                generate,
                watch=args.watch,
                limit=args.limit,
                poll_seconds=args.poll_seconds,
            )
        print(json.dumps(summary, separators=(",", ":")))
        return 0 if summary["failed"] == 0 else 1
    except KeyboardInterrupt:
        return 0
    except (OSError, ValueError):
        print(json.dumps({"status": "fatal", "errorCode": "configuration_error"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
