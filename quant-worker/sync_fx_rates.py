from __future__ import annotations

import argparse
from collections.abc import Callable, Sequence
from datetime import date
import json
from pathlib import Path
from typing import Any

import psycopg

from fx_rates.repository import PostgresFxRateRepository
from fx_rates.vietcombank import (
    FxObservation,
    backfill_window,
    fetch_day,
    inclusive_dates,
)
from ingest_market_data import load_database_url, psycopg_connection_url
from smart_insights.http import UrllibTransport


def sync_range(
    connection: Any,
    *,
    start: date,
    end: date,
    fetcher: Callable[[date], FxObservation],
) -> dict[str, object]:
    repository = PostgresFxRateRepository(connection)
    requested_dates = inclusive_dates(start, end)
    existing = repository.existing_dates(requested_dates)
    stored = 0
    deduplicated = 0
    failed: list[dict[str, str]] = []
    coverage: list[date] = list(existing)
    for requested_date in requested_dates:
        if requested_date in existing:
            deduplicated += 1
            continue
        try:
            observation = fetcher(requested_date)
            if observation.effective_date in existing:
                deduplicated += 1
            else:
                repository.upsert(observation)
                existing.add(observation.effective_date)
                coverage.append(observation.effective_date)
                stored += 1
            connection.commit()
        except Exception as error:  # each date remains independently retryable
            connection.rollback()
            failed.append({"date": requested_date.isoformat(), "error": type(error).__name__})
    return {
        "requested": len(requested_dates),
        "stored": stored,
        "deduplicated": deduplicated,
        "failed": len(failed),
        "failures": failed[:20],
        "coverageStart": min(coverage).isoformat() if coverage else None,
        "coverageEnd": max(coverage).isoformat() if coverage else None,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Synchronize daily Vietcombank USD/VND rates.")
    parser.add_argument("--mode", choices=("daily", "backfill"), default="daily")
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--live-smoke", action="store_true")
    args = parser.parse_args(argv)
    today = date.today()
    default_start, default_end = backfill_window(today) if args.mode == "backfill" else (today, today)
    start = date.fromisoformat(args.start) if args.start else default_start
    end = date.fromisoformat(args.end) if args.end else default_end
    transport = UrllibTransport()
    if args.live_smoke:
        observation = fetch_day(transport, start)
        print(
            json.dumps(
                {
                    "status": "succeeded",
                    "requestedDate": start.isoformat(),
                    "effectiveDate": observation.effective_date.isoformat(),
                    "source": observation.source,
                },
                separators=(",", ":"),
            )
        )
        return 0
    database_url = psycopg_connection_url(load_database_url(Path(args.env_file)))
    with psycopg.connect(database_url) as connection:
        summary = sync_range(
            connection,
            start=start,
            end=end,
            fetcher=lambda requested: fetch_day(transport, requested),
        )
    print(json.dumps(summary, separators=(",", ":")))
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
