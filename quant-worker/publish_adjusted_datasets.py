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
from backtest.corporate_actions import CorporateActionRecord
from backtest.publication import PostgresDatasetPublisher, prepare_dataset_publication
from ingest_market_data import load_database_url, psycopg_connection_url


def _load_actions(connection: Any, asset: str) -> tuple[list[CorporateActionRecord], bool]:
    with connection.cursor(row_factory=dict_row) as cursor:
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
    coverage = rows[0]["metadata"].get("corporateActionCoverage", {}) if rows else {}
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
    return actions, complete


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish immutable total-return VN datasets.")
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--symbol", action="append", default=[])
    args = parser.parse_args(argv)
    url = psycopg_connection_url(load_database_url(Path(args.env_file)))
    published = 0
    skipped = 0
    with psycopg.connect(url, autocommit=False) as connection:
        publisher = PostgresDatasetPublisher(connection)
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT asset.symbol, dataset.timeframe
                FROM assets AS asset
                JOIN datasets AS dataset ON dataset.asset_id = asset.id
                JOIN dataset_versions AS version ON version.dataset_id = dataset.id AND version.is_active = true
                WHERE asset.market = 'vn_equity' AND dataset.adjustment_policy = 'raw'
                  AND (%s::text[] = '{}' OR asset.symbol = ANY(%s::text[]))
                ORDER BY asset.symbol, dataset.timeframe
                """,
                (args.symbol, args.symbol),
            )
            candidates = cursor.fetchall()
        for candidate in candidates:
            symbol = str(candidate["symbol"])
            timeframe = str(candidate["timeframe"])
            raw = publisher.load_active(symbol, timeframe, "raw")
            actions, complete = _load_actions(connection, symbol)
            if raw is None or not complete:
                skipped += 1
                continue
            metadata = raw.source_metadata
            prepared_raw = prepare_dataset_publication(
                list(raw.rows),
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
            adjusted = build_adjusted_publication(
                prepared_raw,
                raw_dataset_version_id=raw.dataset_version_id,
                actions=actions,
                corporate_action_coverage_complete=complete,
            )
            with connection.transaction():
                publisher.publish_if_changed(adjusted)
            published += 1
    print(json.dumps({"status": "succeeded", "published": published, "skipped": skipped}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
