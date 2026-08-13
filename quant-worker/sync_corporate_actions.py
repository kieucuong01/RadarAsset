from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from datetime import date
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from backtest.corporate_actions import (
    PostgresCorporateActionRepository,
    VciCorporateActionAdapter,
)
from ingest_market_data import load_database_url, psycopg_connection_url


def active_vn_equities(connection: psycopg.Connection) -> list[str]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT DISTINCT asset.symbol
            FROM assets AS asset
            JOIN provider_instruments AS instrument ON instrument.asset_id = asset.id
            JOIN data_providers AS provider ON provider.id = instrument.provider_id
            WHERE asset.market = 'vn_equity'
              AND provider.code = 'vnstock-vci-free'
              AND instrument.is_active = true
            ORDER BY asset.symbol
            """,
            (),
        )
        return [str(row["symbol"]) for row in cursor.fetchall()]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync verified VN corporate actions.")
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--symbol", action="append", default=[])
    parser.add_argument("--from-year", type=int, default=date.today().year - 10)
    args = parser.parse_args(argv)
    url = psycopg_connection_url(load_database_url(Path(args.env_file)))
    adapter = VciCorporateActionAdapter()
    succeeded = 0
    failed = 0
    with psycopg.connect(url, autocommit=False) as connection:
        symbols = sorted({value.upper() for value in args.symbol}) or active_vn_equities(connection)
        repository = PostgresCorporateActionRepository(connection)
        for symbol in symbols:
            try:
                result = adapter.fetch(
                    symbol,
                    start=date(max(2000, args.from_year), 1, 1),
                    end=date.today(),
                )
                repository.save(result)
                succeeded += 1
            except Exception:
                connection.rollback()
                failed += 1
    print(json.dumps({"status": "succeeded" if failed == 0 else "partial", "succeeded": succeeded, "failed": failed}))
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
