from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from backtest.adjusted_publication import build_adjusted_publication
from backtest.adjustments import AdjustmentUnavailable
from backtest.corporate_actions import CorporateActionRecord
from backtest.daily_scope import load_daily_scope_symbols
from backtest.ingestion import certified_active_rows
from backtest.publication import PostgresDatasetPublisher, prepare_dataset_publication
from ingest_market_data import load_database_url, psycopg_connection_url


def _load_actions(
    connection: Any, asset: str
) -> tuple[list[CorporateActionRecord], bool, date | None, date | None]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT instrument.metadata
            FROM provider_instruments AS instrument
            JOIN data_providers AS provider ON provider.id = instrument.provider_id
            JOIN assets AS asset ON asset.id = instrument.asset_id
            WHERE provider.code = 'vnstock-vci-free' AND asset.symbol = %s
            LIMIT 1
            """,
            (asset,),
        )
        instrument = cursor.fetchone()
        cursor.execute(
            """
            SELECT action.*, instrument.metadata
            FROM corporate_actions AS action
            JOIN assets AS asset ON asset.id = action.asset_id
            JOIN provider_instruments AS instrument ON instrument.id = action.provider_instrument_id
            WHERE asset.symbol = %s
            ORDER BY action.ex_right_date, action.provider_event_id
            """,
            (asset,),
        )
        rows = cursor.fetchall()
    coverage = (
        instrument["metadata"].get("corporateActionCoverage", {}) if instrument else {}
    )
    complete = coverage.get("complete") is True
    actions = [
        CorporateActionRecord(
            asset=asset,
            provider_code="vnstock-vci-free",
            provider_event_id=str(row["provider_event_id"]),
            action_type=str(row["action_type"]),
            status=str(row["status"]),
            public_date=row["public_date"],
            ex_right_date=row["ex_right_date"],
            record_date=row["record_date"],
            payment_date=row["payment_date"],
            cash_per_share=None if row["cash_per_share"] is None else Decimal(row["cash_per_share"]),
            distribution_ratio=None if row["distribution_ratio"] is None else Decimal(row["distribution_ratio"]),
            subscription_ratio=None if row["subscription_ratio"] is None else Decimal(row["subscription_ratio"]),
            subscription_price=None if row["subscription_price"] is None else Decimal(row["subscription_price"]),
            old_symbol=row["old_symbol"],
            new_symbol=row["new_symbol"],
            source_payload=row["source_payload"],
        )
        for row in rows
    ]
    coverage_start = coverage.get("start")
    coverage_end = coverage.get("end")
    return (
        actions,
        complete,
        date.fromisoformat(coverage_start) if isinstance(coverage_start, str) else None,
        date.fromisoformat(coverage_end) if isinstance(coverage_end, str) else None,
    )


def _deactivate_adjusted_dataset(connection: Any, asset: str, timeframe: str) -> int:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE dataset_versions AS version
            SET is_active = false
            FROM datasets AS dataset
            JOIN assets AS asset ON asset.id = dataset.asset_id
            WHERE version.dataset_id = dataset.id
              AND asset.symbol = %s
              AND dataset.timeframe = %s
              AND dataset.adjustment_policy = 'total_return'
              AND version.is_active = true
            """,
            (asset, timeframe),
        )
        return cursor.rowcount


def _coverage_contains_raw(
    action_start: date | None,
    action_end: date | None,
    raw_start: date,
    raw_end: date,
) -> bool:
    return (
        action_start is not None
        and action_end is not None
        and action_start <= raw_start
        and action_end >= raw_end
    )


def _load_candidates(connection: Any, symbols: Sequence[str]) -> list[dict[str, Any]]:
    if not symbols:
        return []
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT asset.symbol, dataset.timeframe
            FROM assets AS asset
            JOIN datasets AS dataset ON dataset.asset_id = asset.id
            JOIN dataset_versions AS version ON version.dataset_id = dataset.id AND version.is_active = true
            WHERE asset.market = 'vn_equity'
              AND dataset.adjustment_policy = 'raw'
              AND dataset.timeframe = '1d'
              AND asset.symbol = ANY(%s::text[])
            ORDER BY asset.symbol, dataset.timeframe
            """,
            (list(symbols),),
        )
        return list(cursor.fetchall())


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish immutable total-return VN datasets.")
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--symbol", action="append", default=[])
    args = parser.parse_args(argv)
    url = psycopg_connection_url(load_database_url(Path(args.env_file)))
    published = 0
    unchanged = 0
    skipped = 0
    blocked = 0
    blocked_reasons = {"coverage": 0, "unverified": 0, "quality": 0}
    with psycopg.connect(url, autocommit=False) as connection:
        publisher = PostgresDatasetPublisher(connection)
        daily_symbols = load_daily_scope_symbols(connection)
        requested = {str(symbol).strip().upper() for symbol in args.symbol if str(symbol).strip()}
        allowed_symbols = tuple(
            symbol for symbol in daily_symbols if not requested or symbol in requested
        )
        candidates = _load_candidates(connection, allowed_symbols)
        for candidate in candidates:
            symbol = str(candidate["symbol"])
            timeframe = str(candidate["timeframe"])
            raw = publisher.load_active(symbol, timeframe, "raw")
            actions, complete, action_start, action_end = _load_actions(connection, symbol)
            if raw is None:
                skipped += 1
                continue
            active_rows = certified_active_rows(raw.rows, market="vn_equity")
            if not active_rows:
                skipped += 1
                continue
            raw_start = active_rows[0].timestamp.date()
            raw_end = active_rows[-1].timestamp.date()
            if not complete or not _coverage_contains_raw(
                action_start, action_end, raw_start, raw_end
            ):
                with connection.transaction():
                    _deactivate_adjusted_dataset(connection, symbol, timeframe)
                blocked += 1
                blocked_reasons["coverage"] += 1
                continue
            metadata = raw.source_metadata
            prepared_raw = prepare_dataset_publication(
                list(active_rows),
                market="vn_equity",
                provider_code=str(metadata.get("provider", "vnstock-vci-free")),
                provider_name="Vnstock VCI Free",
                provider_symbol=symbol,
                canonical_key=f"vn_equity:HOSE:{symbol}",
                asset_name=symbol,
                currency="VND",
                venue="HOSE",
                timezone_name="Asia/Ho_Chi_Minh",
                maximum_leverage=Decimal("2"),
                terms_url="https://vnstocks.com/docs/vnstock",
                source_metadata=metadata,
            )
            try:
                adjusted = build_adjusted_publication(
                    prepared_raw,
                    raw_dataset_version_id=raw.dataset_version_id,
                    actions=actions,
                    corporate_action_coverage_complete=complete,
                    corporate_action_coverage_start=action_start.isoformat(),
                    corporate_action_coverage_end=action_end.isoformat(),
                )
            except AdjustmentUnavailable as error:
                with connection.transaction():
                    _deactivate_adjusted_dataset(connection, symbol, timeframe)
                blocked += 1
                reason = "unverified" if "unverified" in str(error).lower() else "quality"
                blocked_reasons[reason] += 1
                continue
            with connection.transaction():
                publication = publisher.publish_if_changed(adjusted)
            if publication.status == "unchanged":
                unchanged += 1
            else:
                published += 1
    print(
        json.dumps(
            {
                "status": "succeeded",
                "published": published,
                "unchanged": unchanged,
                "skipped": skipped,
                "blocked": blocked,
                "blockedReasons": blocked_reasons,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
