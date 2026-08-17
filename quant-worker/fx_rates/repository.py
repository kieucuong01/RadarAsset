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

    def existing_dates(self, dates: Iterable[date]) -> set[date]:
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
                  AND source = 'vietcombank'
                  AND effective_date = ANY(%s::date[])
                """,
                (values,),
            )
            return {row[0] for row in cursor.fetchall()}
