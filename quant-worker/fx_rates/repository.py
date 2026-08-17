from __future__ import annotations

from collections.abc import Iterable
from datetime import date
from typing import Any

from fx_rates.vietcombank import FxObservation


UPSERT_SQL = """
INSERT INTO fx_rates (
  base_currency, quote_currency, effective_date,
  transfer_buy, sell, mid, source, fetched_at
)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (base_currency, quote_currency, effective_date, source)
DO UPDATE SET
  transfer_buy = EXCLUDED.transfer_buy,
  sell = EXCLUDED.sell,
  mid = EXCLUDED.mid,
  fetched_at = EXCLUDED.fetched_at,
  updated_at = CURRENT_TIMESTAMP
"""

BACKFILL_TRANSACTION_SNAPSHOTS_SQL = """
WITH snapshots AS (
  SELECT transaction.id, selected.mid, selected.effective_date, selected.source
  FROM portfolio_transactions AS transaction
  JOIN LATERAL (
    SELECT rate.mid, rate.effective_date, rate.source
    FROM fx_rates AS rate
    WHERE rate.base_currency = 'USD'
      AND rate.quote_currency = 'VND'
      AND rate.effective_date <= transaction.executed_at::date
    ORDER BY rate.effective_date DESC,
             CASE WHEN rate.source = 'vietcombank' THEN 0 ELSE 1 END,
             rate.fetched_at DESC
    LIMIT 1
  ) AS selected ON true
  WHERE transaction.fx_fallback = true
)
UPDATE portfolio_transactions AS transaction
SET fx_rate_to_vnd = snapshots.mid,
    fx_effective_date = snapshots.effective_date,
    fx_source = snapshots.source,
    fx_fallback = false
FROM snapshots
WHERE transaction.id = snapshots.id
"""


class PostgresFxRateRepository:
    def __init__(self, connection: Any) -> None:
        self.connection = connection

    def upsert(self, observation: FxObservation) -> None:
        with self.connection.cursor() as cursor:
            cursor.execute(
                UPSERT_SQL,
                (
                    "USD",
                    "VND",
                    observation.effective_date,
                    observation.transfer_buy,
                    observation.sell,
                    observation.mid,
                    observation.source,
                    observation.fetched_at,
                ),
            )

    def existing_dates(self, dates: Iterable[date], *, source: str = "vietcombank") -> set[date]:
        values = list(dates)
        if not values:
            return set()
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT effective_date
                FROM fx_rates
                WHERE base_currency = 'USD'
                  AND quote_currency = 'VND'
                  AND source = %s
                  AND effective_date = ANY(%s::date[])
                """,
                (source, values),
            )
            return {row[0] for row in cursor.fetchall()}

    def backfill_transaction_snapshots(self) -> int:
        with self.connection.cursor() as cursor:
            cursor.execute(BACKFILL_TRANSACTION_SNAPSHOTS_SQL)
            return int(cursor.rowcount)
