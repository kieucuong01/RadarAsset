from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import psycopg
from psycopg.rows import dict_row

from ingest_market_data import load_database_url, psycopg_connection_url


DAILY_PIPELINE_SQL = """
WITH latest_market AS (
  SELECT id, status, finished_at
  FROM market_ingestion_scheduler_runs
  WHERE command = 'daily' AND started_at >= %s AND started_at < %s
  ORDER BY started_at DESC
  LIMIT 1
), membership_total AS (
  SELECT COUNT(*)::int AS count FROM organization_memberships
), briefing_coverage AS (
  SELECT COUNT(DISTINCT (briefing.organization_id, briefing.user_id))::int AS count,
         MAX(briefing.created_at) AS latest_at
  FROM daily_briefings AS briefing
  JOIN organization_memberships AS membership
    ON membership.organization_id = briefing.organization_id
   AND membership.user_id = briefing.user_id
  WHERE briefing.effective_date = %s
    AND briefing.status IN ('complete', 'quant_only')
), fx_coverage AS (
  SELECT MAX(effective_date) AS effective_date
  FROM fx_rates
  WHERE base_currency = 'USD'
    AND quote_currency = 'VND'
    AND source = 'vietcombank'
    AND effective_date <= %s
)
SELECT market.id AS market_run_id,
       market.status AS market_run_status,
       market.finished_at AS market_finished_at,
       membership.count AS membership_count,
       briefing.count AS briefing_count,
       briefing.latest_at AS latest_briefing_at,
       fx.effective_date AS fx_effective_date
FROM membership_total AS membership
CROSS JOIN briefing_coverage AS briefing
CROSS JOIN fx_coverage AS fx
LEFT JOIN latest_market AS market ON true
"""


def _day_bounds(local_date: date, timezone_name: str) -> tuple[datetime, datetime]:
    zone = ZoneInfo(timezone_name)
    start = datetime.combine(local_date, time.min, tzinfo=zone)
    end = datetime.combine(local_date + timedelta(days=1), time.min, tzinfo=zone)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def load_daily_pipeline_health(
    connection: Any, local_date: date, timezone_name: str
) -> dict[str, Any]:
    start, end = _day_bounds(local_date, timezone_name)
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(DAILY_PIPELINE_SQL, (start, end, local_date, local_date))
        row = cursor.fetchone()
    if row is None:
        raise RuntimeError("Daily pipeline health query returned no result.")
    return dict(row)


def verify_daily_pipeline_health(
    row: Mapping[str, Any], *, local_date: date | None = None
) -> list[str]:
    if row.get("market_run_id") is None:
        return ["DAILY_MARKET_RUN_MISSING"]
    if row.get("market_run_status") != "succeeded" or row.get("market_finished_at") is None:
        return ["DAILY_MARKET_RUN_FAILED"]
    if int(row.get("briefing_count") or 0) < int(row.get("membership_count") or 0):
        return ["DAILY_BRIEFING_INCOMPLETE"]
    fx_effective_date = row.get("fx_effective_date")
    if not isinstance(fx_effective_date, date):
        return ["DAILY_FX_RATE_MISSING"]
    effective_local_date = local_date or date.today()
    if (effective_local_date - fx_effective_date).days > 4:
        return ["DAILY_FX_RATE_STALE"]
    return []


def _serialized(value: object) -> object:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    return value


def build_output(
    row: Mapping[str, Any],
    *,
    local_date: date,
    timezone_name: str,
    errors: Sequence[str],
) -> dict[str, Any]:
    return {
        "status": "succeeded" if not errors else "failed",
        "localDate": local_date.isoformat(),
        "timezone": timezone_name,
        "market": {
            "runId": _serialized(row.get("market_run_id")),
            "status": row.get("market_run_status"),
            "finishedAt": _serialized(row.get("market_finished_at")),
        },
        "briefings": {
            "expected": int(row.get("membership_count") or 0),
            "published": int(row.get("briefing_count") or 0),
            "latestAt": _serialized(row.get("latest_briefing_at")),
        },
        "fx": {
            "effectiveDate": _serialized(row.get("fx_effective_date")),
            "source": "vietcombank",
        },
        "errors": list(errors),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify the fail-closed daily decision pipeline.")
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--local-date")
    parser.add_argument("--timezone", default="Asia/Bangkok")
    args = parser.parse_args(argv)
    try:
        zone = ZoneInfo(args.timezone)
        local_date = (
            date.fromisoformat(args.local_date)
            if args.local_date
            else datetime.now(timezone.utc).astimezone(zone).date()
        )
        url = psycopg_connection_url(load_database_url(Path(args.env_file)))
        with psycopg.connect(url, row_factory=dict_row) as connection:
            row = load_daily_pipeline_health(connection, local_date, args.timezone)
        errors = verify_daily_pipeline_health(row, local_date=local_date)
        print(
            json.dumps(
                build_output(
                    row,
                    local_date=local_date,
                    timezone_name=args.timezone,
                    errors=errors,
                ),
                separators=(",", ":"),
            )
        )
        return 0 if not errors else 1
    except (OSError, ValueError, ZoneInfoNotFoundError, psycopg.Error):
        print(json.dumps({"status": "failed", "errors": ["DAILY_PIPELINE_VERIFY_FAILED"]}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
