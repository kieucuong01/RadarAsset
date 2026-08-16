from __future__ import annotations

from typing import Any

from .catalog import FEEDS


CORE_DAILY_SYMBOLS = tuple(sorted(FEEDS))
APPROVED_DAILY_PROVIDER_CODES = (
    "binance-public",
    "dukascopy-public",
    "vnstock-kbs-free",
    "vnstock-vci-free",
)


def load_daily_scope_symbols(connection: Any) -> tuple[str, ...]:
    """Return the curated plus demand-driven daily decision universe."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT DISTINCT UPPER(asset.symbol) AS symbol
            FROM assets AS asset
            JOIN provider_instruments AS instrument ON instrument.asset_id = asset.id
            JOIN data_providers AS provider ON provider.id = instrument.provider_id
            WHERE instrument.is_active = true
              AND provider.status = 'active'
              AND provider.code IN (
                'binance-public', 'dukascopy-public',
                'vnstock-kbs-free', 'vnstock-vci-free'
              )
              AND asset.market IN ('vn_equity', 'crypto_spot', 'metal_spot')
              AND (
                UPPER(asset.symbol) = ANY(%s)
                OR EXISTS (
                  SELECT 1
                  FROM portfolio_positions AS position
                  WHERE position.asset_id = asset.id AND position.quantity > 0
                )
                OR EXISTS (
                  SELECT 1
                  FROM watchlist_items AS watchlist
                  WHERE watchlist.asset_id = asset.id
                )
              )
            ORDER BY symbol
            """,
            (list(CORE_DAILY_SYMBOLS),),
        )
        rows = cursor.fetchall()
    return tuple(
        sorted(
            {
                str(row[0] if not isinstance(row, dict) else row["symbol"])
                .strip()
                .upper()
                for row in rows
                if str(row[0] if not isinstance(row, dict) else row["symbol"]).strip()
            }
        )
    )
