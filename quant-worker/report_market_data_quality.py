from __future__ import annotations

import argparse
import json
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from backtest.daily_scope import load_daily_scope_symbols
from backtest.market_calendar import is_session_day, timestamp_to_market_date
from ingest_market_data import load_database_url, psycopg_connection_url


QUALITY_SQL = """
WITH active AS (
  SELECT version.id, asset.market, dataset.timeframe, provider.code AS provider_code,
         version.missing_bar_count
  FROM dataset_versions version
  JOIN datasets dataset ON dataset.id = version.dataset_id
  JOIN assets asset ON asset.id = dataset.asset_id
  JOIN data_providers provider ON provider.id = version.provider_id
  WHERE version.is_active = true AND dataset.adjustment_policy = 'raw'
    AND dataset.timeframe = '1d'
    AND UPPER(asset.symbol) = ANY(%s)
), classified AS (
  SELECT active.market, active.timeframe, active.provider_code,
         issue.classification, issue.range_start, issue.range_end,
         COALESCE((issue.details->>'missingCount')::int, 1) AS missing_count
  FROM active
  JOIN data_quality_issues issue ON issue.dataset_version_id = active.id
  WHERE issue.classification IS NOT NULL
), legacy AS (
  SELECT active.market, active.timeframe, active.provider_code,
         NULL::text AS classification, NULL::timestamptz AS range_start,
         NULL::timestamptz AS range_end, active.missing_bar_count AS missing_count
  FROM active
  WHERE active.missing_bar_count > 0
    AND NOT EXISTS (
      SELECT 1 FROM data_quality_issues issue
      WHERE issue.dataset_version_id = active.id AND issue.classification IS NOT NULL
    )
)
SELECT * FROM classified
UNION ALL
SELECT * FROM legacy
"""


def _iso(value: object) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


def normalize_daily_quality_rows(
    rows: Iterable[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    """Reconcile persisted gap issues against the current explicit calendar."""
    normalized: list[Mapping[str, Any]] = []
    for row in rows:
        start = row.get("range_start")
        end = row.get("range_end")
        market = str(row["market"])
        if (
            row.get("classification") != "PROVIDER_GAP"
            or row.get("timeframe") != "1d"
            or not isinstance(start, datetime)
            or not isinstance(end, datetime)
        ):
            normalized.append(row)
            continue
        current = timestamp_to_market_date(start, market)
        last = timestamp_to_market_date(end, market)
        session_count = 0
        while current <= last:
            session_count += int(is_session_day(current, market))
            current += timedelta(days=1)
        missing_count = min(int(row["missing_count"]), session_count)
        if missing_count > 0:
            normalized.append({**row, "missing_count": missing_count})
    return normalized


def aggregate_quality_rows(rows: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    grouped: dict[tuple[str, str, str, str, str | None, str | None], int] = {}
    for row in rows:
        key = (
            str(row["market"]),
            str(row["timeframe"]),
            str(row["provider_code"]),
            str(row["classification"] or "LEGACY_UNCLASSIFIED"),
            _iso(row.get("range_start")),
            _iso(row.get("range_end")),
        )
        grouped[key] = grouped.get(key, 0) + int(row["missing_count"])
    groups = [
        {
            "market": key[0],
            "timeframe": key[1],
            "providerCode": key[2],
            "classification": key[3],
            "rangeStart": key[4],
            "rangeEnd": key[5],
            "missingBarCount": count,
        }
        for key, count in sorted(grouped.items())
    ]
    missing = sum(group["missingBarCount"] for group in groups)
    return {
        "status": "healthy" if missing == 0 else "degraded",
        "groupCount": len(groups),
        "missingBarCount": missing,
        "groups": groups,
    }


def load_quality_rows(
    connection: Any, allowed_symbols: Sequence[str] | None = None
) -> list[Mapping[str, Any]]:
    scope = tuple(
        sorted(
            dict.fromkeys(
                symbol.strip().upper()
                for symbol in (
                    allowed_symbols
                    if allowed_symbols is not None
                    else load_daily_scope_symbols(connection)
                )
                if symbol.strip()
            )
        )
    )
    if not scope:
        raise ValueError("Daily market ingestion scope is empty.")
    with connection.cursor() as cursor:
        cursor.execute(QUALITY_SQL, (list(scope),))
        return list(cursor.fetchall())


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report active Quant dataset quality.")
    parser.add_argument("--env-file", default=".env.local")
    args = parser.parse_args(argv)
    try:
        url = psycopg_connection_url(load_database_url(Path(args.env_file)))
        with psycopg.connect(url, row_factory=dict_row) as connection:
            report = aggregate_quality_rows(
                normalize_daily_quality_rows(load_quality_rows(connection))
            )
        print(json.dumps(report, separators=(",", ":")))
        return 0
    except (OSError, ValueError, psycopg.Error):
        print(json.dumps({"status": "failed", "errorCode": "quality_report_failed"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
