from __future__ import annotations

import argparse
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
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
from fx_rates.yahoo import fetch_range as fetch_yahoo_range
from ingest_market_data import load_database_url, psycopg_connection_url
from smart_insights.http import UrllibTransport


def sync_range(
    connection: Any,
    *,
    start: date,
    end: date,
    fetcher: Callable[[date], FxObservation],
    max_workers: int = 1,
) -> dict[str, object]:
    repository = PostgresFxRateRepository(connection)
    requested_dates = inclusive_dates(start, end)
    existing = repository.existing_dates(requested_dates)
    stored = 0
    deduplicated = 0
    failed: list[dict[str, str]] = []
    coverage: list[date] = list(existing)
    pending_dates: list[date] = []
    for requested_date in requested_dates:
        if requested_date in existing:
            deduplicated += 1
        else:
            pending_dates.append(requested_date)

    def fetch_result(requested_date: date) -> tuple[date, FxObservation | None, Exception | None]:
        try:
            return requested_date, fetcher(requested_date), None
        except Exception as error:
            return requested_date, None, error

    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as executor:
        results = executor.map(fetch_result, pending_dates)
        for requested_date, observation, error in results:
            if error is not None or observation is None:
                failed.append(
                    {"date": requested_date.isoformat(), "error": type(error).__name__}
                )
                continue
            try:
                if observation.effective_date in existing:
                    deduplicated += 1
                else:
                    repository.upsert(observation)
                    existing.add(observation.effective_date)
                    coverage.append(observation.effective_date)
                    stored += 1
                connection.commit()
            except Exception as error:
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


def sync_yahoo_history(connection: Any, *, start: date, end: date, transport: UrllibTransport) -> dict[str, object]:
    observations = fetch_yahoo_range(transport, start=start, end=end)
    repository = PostgresFxRateRepository(connection)
    requested_dates = inclusive_dates(start, end)
    existing = repository.existing_dates(requested_dates, source="yahoo_finance")
    stored = 0
    deduplicated = 0
    for observation in observations:
        if observation.effective_date in existing:
            deduplicated += 1
            continue
        repository.upsert(observation)
        existing.add(observation.effective_date)
        stored += 1
    connection.commit()
    updated_snapshots = repository.backfill_transaction_snapshots()
    connection.commit()
    coverage = sorted(existing)
    return {
        "requested": len(requested_dates),
        "stored": stored,
        "deduplicated": deduplicated,
        "failed": 0,
        "failures": [],
        "coverageStart": coverage[0].isoformat() if coverage else None,
        "coverageEnd": coverage[-1].isoformat() if coverage else None,
        "source": "yahoo_finance",
        "transactionSnapshotsUpdated": updated_snapshots,
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
        if args.mode == "backfill":
            observations = fetch_yahoo_range(transport, start=start, end=end)
            observation = observations[0]
        else:
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
        if args.mode == "backfill":
            summary = sync_yahoo_history(connection, start=start, end=end, transport=transport)
        else:
            summary = sync_range(
                connection,
                start=start,
                end=end,
                fetcher=lambda requested: fetch_day(transport, requested),
            )
            if summary["failed"]:
                summary = sync_yahoo_history(
                    connection,
                    start=start - timedelta(days=7),
                    end=end,
                    transport=transport,
                ) | {"fallbackFrom": "vietcombank"}
    print(json.dumps(summary, separators=(",", ":")))
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
