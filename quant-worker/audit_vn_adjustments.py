from __future__ import annotations

import argparse
import json
from collections import defaultdict
from collections.abc import Sequence
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from backtest.adjustment_audit import (
    IndependentFactors,
    audit_adjusted_factors,
    independent_event_factors,
    select_audit_basket,
)
from backtest.adjustments import AdjustmentUnavailable
from backtest.corporate_actions import CorporateActionRecord
from ingest_market_data import load_database_url, psycopg_connection_url


AUDIT_SQL = """
SELECT asset.symbol,
       asset.listing_status,
       action.provider_event_id,
       action.action_type,
       action.status,
       action.public_date,
       action.ex_right_date,
       action.record_date,
       action.payment_date,
       action.cash_per_share,
       action.distribution_ratio,
       action.subscription_ratio,
       action.subscription_price,
       action.old_symbol,
       action.new_symbol,
       raw_version.id::text AS raw_version_id,
       raw_version.checksum AS raw_checksum,
       adjusted_version.source_metadata->>'rawDatasetVersionId' AS adjusted_raw_version_id,
       raw_bar.close AS raw_close,
       raw_bar.volume AS raw_volume,
       adjusted_bar.close AS adjusted_close,
       adjusted_bar.volume AS adjusted_volume
FROM corporate_actions action
JOIN assets asset ON asset.id = action.asset_id
JOIN datasets raw_dataset
  ON raw_dataset.asset_id = asset.id
 AND raw_dataset.timeframe = '1d'
 AND raw_dataset.adjustment_policy = 'raw'
JOIN dataset_versions raw_version
  ON raw_version.dataset_id = raw_dataset.id
 AND raw_version.is_active = true
LEFT JOIN datasets adjusted_dataset
  ON adjusted_dataset.asset_id = asset.id
 AND adjusted_dataset.timeframe = '1d'
 AND adjusted_dataset.adjustment_policy = 'total_return'
LEFT JOIN dataset_versions adjusted_version
  ON adjusted_version.dataset_id = adjusted_dataset.id
 AND adjusted_version.is_active = true
LEFT JOIN LATERAL (
  SELECT bar.ts, bar.close, bar.volume
  FROM dataset_bars bar
  WHERE bar.dataset_version_id = raw_version.id
    AND action.ex_right_date IS NOT NULL
    AND (bar.ts AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < action.ex_right_date
  ORDER BY bar.ts DESC
  LIMIT 1
) raw_bar ON true
LEFT JOIN dataset_bars adjusted_bar
  ON adjusted_bar.dataset_version_id = adjusted_version.id
 AND adjusted_bar.ts = raw_bar.ts
WHERE asset.market = 'vn_equity'
ORDER BY asset.symbol, action.ex_right_date, action.provider_event_id
"""


def _decimal(value: Any) -> Decimal | None:
    return None if value is None else Decimal(value)


def build_audit_report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    basket = select_audit_basket(
        {
            "symbol": row["symbol"],
            "listingStatus": row["listing_status"],
            "actionType": row["action_type"],
            "status": row["status"],
        }
        for row in rows
    )
    grouped: dict[tuple[str, date], list[dict[str, Any]]] = defaultdict(list)
    unresolved = 0
    lineage_failures = 0
    for row in rows:
        if row["status"] != "verified" or row["ex_right_date"] is None:
            unresolved += 1
            continue
        grouped[(str(row["symbol"]), row["ex_right_date"])].append(row)

    action_groups: dict[tuple[str, date], tuple[list[CorporateActionRecord], IndependentFactors]] = {}
    for (symbol, ex_date), event_rows in sorted(grouped.items()):
        first = event_rows[0]
        if first["raw_close"] is None:
            continue
        actions = [
            CorporateActionRecord(
                asset=symbol,
                provider_code="vnstock-vci-free",
                provider_event_id=str(row["provider_event_id"]),
                action_type=str(row["action_type"]),
                status=str(row["status"]),
                public_date=row["public_date"],
                ex_right_date=row["ex_right_date"],
                record_date=row["record_date"],
                payment_date=row["payment_date"],
                cash_per_share=_decimal(row["cash_per_share"]),
                distribution_ratio=_decimal(row["distribution_ratio"]),
                subscription_ratio=_decimal(row["subscription_ratio"]),
                subscription_price=_decimal(row["subscription_price"]),
                old_symbol=row["old_symbol"],
                new_symbol=row["new_symbol"],
                source_payload={},
            )
            for row in event_rows
        ]
        try:
            factor = independent_event_factors(
                _decimal(first["raw_close"]) or Decimal(0),
                actions,
                cash_value_scale=Decimal("1000"),
            )
        except AdjustmentUnavailable:
            continue
        action_groups[(symbol, ex_date)] = (actions, factor)

    cases: list[dict[str, Any]] = []
    for (symbol, ex_date), event_rows in sorted(grouped.items()):
        first = event_rows[0]
        lineage_ok = (
            first["adjusted_raw_version_id"] is not None
            and first["adjusted_raw_version_id"] == first["raw_version_id"]
        )
        if not lineage_ok:
            lineage_failures += 1
        status = "blocked"
        deltas: dict[str, str] = {}
        if (
            lineage_ok
            and first["raw_close"] is not None
            and first["adjusted_close"] is not None
        ):
            try:
                suffix_factors = [
                    factor
                    for (factor_symbol, factor_date), (_, factor) in sorted(action_groups.items())
                    if factor_symbol == symbol and factor_date >= ex_date
                ]
                observed = audit_adjusted_factors(
                    raw_close=_decimal(first["raw_close"]) or Decimal(0),
                    adjusted_close=_decimal(first["adjusted_close"]) or Decimal(0),
                    raw_volume=_decimal(first["raw_volume"]),
                    adjusted_volume=_decimal(first["adjusted_volume"]),
                    factors=suffix_factors,
                )
                status = observed.pop("status")
                deltas = observed
            except AdjustmentUnavailable:
                status = "blocked"
        cases.append(
            {
                "symbol": symbol,
                "exRightDate": ex_date.isoformat(),
                "eventTypes": sorted({str(row["action_type"]) for row in event_rows}),
                "rawDatasetVersionId": first["raw_version_id"],
                "rawChecksum": first["raw_checksum"],
                "lineageValid": lineage_ok,
                "status": status,
                **deltas,
            }
        )

    failed = sum(case["status"] != "passed" for case in cases)
    required = {"cash_dividend", "stock_dividend", "split", "rights_issue", "inactive", "unresolved"}
    covered = {item["category"] for item in basket}
    missing_categories = sorted(required - covered)
    status = (
        "passed"
        if cases and failed == 0 and unresolved == 0 and not missing_categories
        else "blocked"
    )
    return {
        "status": status,
        "rawDataMutated": False,
        "basket": basket,
        "missingBasketCategories": missing_categories,
        "caseCount": len(cases),
        "failedCaseCount": failed,
        "lineageFailureCount": lineage_failures,
        "unresolvedActionCount": unresolved,
        "cases": cases,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit VN raw/adjusted lineage and factors.")
    parser.add_argument("--env-file", default=".env.local")
    args = parser.parse_args(argv)
    try:
        url = psycopg_connection_url(load_database_url(Path(args.env_file)))
        with psycopg.connect(url, row_factory=dict_row) as connection:
            with connection.cursor() as cursor:
                cursor.execute(AUDIT_SQL)
                report = build_audit_report(cursor.fetchall())
        print(json.dumps(report, separators=(",", ":"), default=str))
        return 0 if report["status"] == "passed" else 2
    except (OSError, ValueError, psycopg.Error):
        print(json.dumps({"status": "failed", "errorCode": "adjustment_audit_failed"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
