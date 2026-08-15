from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any, Sequence

import psycopg
from psycopg.rows import dict_row

from ingest_market_data import load_database_url, psycopg_connection_url


@dataclass(frozen=True, slots=True)
class UnsupportedAsset:
    id: str
    symbol: str
    asset_class: str
    market: str


_TARGET_SQL = """
SELECT id, symbol, asset_class, market
FROM assets
WHERE LOWER(asset_class) IN ('equity', 'etf', 'stock')
  AND market <> 'vn_equity'
ORDER BY symbol
"""

_DEPENDENCY_COUNT_SQL = {
    "portfolioPositions": "SELECT COUNT(*)::int AS count FROM portfolio_positions WHERE asset_id = ANY(%s::uuid[])",
    "portfolioTransactions": "SELECT COUNT(*)::int AS count FROM portfolio_transactions WHERE asset_id = ANY(%s::uuid[])",
    "watchlistItems": "SELECT COUNT(*)::int AS count FROM watchlist_items WHERE asset_id = ANY(%s::uuid[])",
    "researchRuns": "SELECT COUNT(*)::int AS count FROM research_runs WHERE asset_id = ANY(%s::uuid[])",
    "aiInsights": "SELECT COUNT(*)::int AS count FROM ai_insights WHERE asset_id = ANY(%s::uuid[])",
    "evidenceItems": "SELECT COUNT(*)::int AS count FROM evidence_items WHERE asset_id = ANY(%s::uuid[])",
    "investmentTheses": "SELECT COUNT(*)::int AS count FROM investment_theses WHERE asset_id = ANY(%s::uuid[])",
    "forecastPoints": "SELECT COUNT(*)::int AS count FROM forecast_points WHERE asset_id = ANY(%s::uuid[])",
    "modelEvaluations": "SELECT COUNT(*)::int AS count FROM model_evaluations WHERE asset_id = ANY(%s::uuid[])",
    "metricObservations": "SELECT COUNT(*)::int AS count FROM metric_observations WHERE asset_id = ANY(%s::uuid[])",
    "signalSnapshots": "SELECT COUNT(*)::int AS count FROM signal_snapshots WHERE asset_id = ANY(%s::uuid[])",
    "strategyAssignments": "SELECT COUNT(*)::int AS count FROM strategy_assignments WHERE asset_id = ANY(%s::uuid[])",
    "strategySignals": "SELECT COUNT(*)::int AS count FROM strategy_signals WHERE asset_id = ANY(%s::uuid[])",
    "quantRunLegs": "SELECT COUNT(*)::int AS count FROM quant_run_legs WHERE asset_id = ANY(%s::uuid[])",
    "providerInstruments": "SELECT COUNT(*)::int AS count FROM provider_instruments WHERE asset_id = ANY(%s::uuid[])",
    "datasets": "SELECT COUNT(*)::int AS count FROM datasets WHERE asset_id = ANY(%s::uuid[])",
    "marketBars": "SELECT COUNT(*)::int AS count FROM market_bars WHERE asset_id = ANY(%s::uuid[])",
}

_DELETE_SQL = (
    """DELETE FROM daily_briefing_items WHERE ai_insight_id IN
         (SELECT id FROM ai_insights WHERE asset_id = ANY(%s::uuid[]))
         OR signal_snapshot_id IN
         (SELECT id FROM signal_snapshots WHERE asset_id = ANY(%s::uuid[]))""",
    """DELETE FROM portfolio_transactions WHERE asset_id = ANY(%s::uuid[])
         OR source_signal_id IN
         (SELECT id FROM strategy_signals WHERE asset_id = ANY(%s::uuid[])
          OR dataset_version_id IN
          (SELECT version.id FROM dataset_versions version JOIN datasets dataset
           ON dataset.id = version.dataset_id WHERE dataset.asset_id = ANY(%s::uuid[])))""",
    "DELETE FROM portfolio_positions WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM watchlist_items WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM strategy_assignments WHERE asset_id = ANY(%s::uuid[])",
    """DELETE FROM strategy_signals WHERE asset_id = ANY(%s::uuid[])
         OR dataset_version_id IN
         (SELECT version.id FROM dataset_versions version JOIN datasets dataset
          ON dataset.id = version.dataset_id WHERE dataset.asset_id = ANY(%s::uuid[]))""",
    """DELETE FROM quant_runs WHERE id IN
         (SELECT leg.quant_run_id FROM quant_run_legs leg
          LEFT JOIN dataset_versions version ON version.id = leg.dataset_version_id
          LEFT JOIN datasets dataset ON dataset.id = version.dataset_id
          WHERE leg.asset_id = ANY(%s::uuid[]) OR dataset.asset_id = ANY(%s::uuid[]))""",
    "DELETE FROM quant_run_legs WHERE asset_id = ANY(%s::uuid[])",
    """DELETE FROM strategy_evaluation_jobs WHERE dataset_version_id IN
         (SELECT version.id FROM dataset_versions version JOIN datasets dataset
          ON dataset.id = version.dataset_id WHERE dataset.asset_id = ANY(%s::uuid[]))""",
    """DELETE FROM strategy_forward_snapshots WHERE dataset_version_id IN
         (SELECT version.id FROM dataset_versions version JOIN datasets dataset
          ON dataset.id = version.dataset_id WHERE dataset.asset_id = ANY(%s::uuid[]))""",
    """DELETE FROM market_ingestion_requests WHERE provider_instrument_id IN
         (SELECT id FROM provider_instruments WHERE asset_id = ANY(%s::uuid[]))
         OR dataset_version_id IN
         (SELECT version.id FROM dataset_versions version JOIN datasets dataset
          ON dataset.id = version.dataset_id WHERE dataset.asset_id = ANY(%s::uuid[]))""",
    """DELETE FROM market_ingestion_runs WHERE asset_symbol = ANY(%s)
         OR dataset_version_id IN
         (SELECT version.id FROM dataset_versions version JOIN datasets dataset
          ON dataset.id = version.dataset_id WHERE dataset.asset_id = ANY(%s::uuid[]))""",
    "DELETE FROM corporate_actions WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM asset_listing_periods WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM research_runs WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM ai_insights WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM evidence_items WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM investment_theses WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM forecast_points WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM model_evaluations WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM metric_observations WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM signal_snapshots WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM provider_instruments WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM datasets WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM market_bars WHERE asset_id = ANY(%s::uuid[])",
    "DELETE FROM instrument_catalog_snapshots WHERE asset_id = ANY(%s::uuid[])",
)


def discover_unsupported_assets(connection: Any) -> tuple[UnsupportedAsset, ...]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(_TARGET_SQL)
        rows = cursor.fetchall()
    return tuple(
        UnsupportedAsset(
            id=str(row["id"]),
            symbol=str(row["symbol"]),
            asset_class=str(row["asset_class"]),
            market=str(row["market"]),
        )
        for row in rows
    )


def _dependency_counts(connection: Any, asset_ids: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    with connection.cursor(row_factory=dict_row) as cursor:
        for name, query in _DEPENDENCY_COUNT_SQL.items():
            cursor.execute(query, (asset_ids,))
            row = cursor.fetchone()
            counts[name] = int(row["count"]) if row is not None else 0
    return counts


def _parameters(query: str, asset_ids: list[str], symbols: list[str]) -> tuple[Any, ...]:
    placeholders = query.count("%s")
    if query.lstrip().startswith("DELETE FROM market_ingestion_runs"):
        return (symbols, asset_ids)
    return tuple(asset_ids for _ in range(placeholders))


def purge_unsupported_equities(
    connection: Any, *, apply: bool = False
) -> dict[str, object]:
    targets = discover_unsupported_assets(connection)
    symbols = [row.symbol for row in targets]
    if not targets:
        return {
            "mode": "apply" if apply else "dry-run",
            "assetCount": 0,
            "deletedAssetCount": 0,
            "dependencyCounts": {},
            "symbols": [],
        }
    asset_ids = [row.id for row in targets]
    dependency_counts = _dependency_counts(connection, asset_ids)
    report: dict[str, object] = {
        "mode": "apply" if apply else "dry-run",
        "assetCount": len(targets),
        "deletedAssetCount": 0,
        "dependencyCounts": dependency_counts,
        "symbols": symbols,
    }
    if not apply:
        return report

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext('purge-unsupported-equities'))")
            for query in _DELETE_SQL:
                cursor.execute(query, _parameters(query, asset_ids, symbols))
            cursor.execute(
                "DELETE FROM assets WHERE id = ANY(%s::uuid[])",
                (asset_ids,),
            )
            deleted = cursor.rowcount
            if deleted != len(targets):
                raise RuntimeError("Unsupported asset purge count changed during apply.")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    report["deletedAssetCount"] = deleted
    return report


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Permanently remove foreign equities and ETFs plus dependent history."
    )
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    try:
        url = psycopg_connection_url(load_database_url(Path(args.env_file)))
        with psycopg.connect(url) as connection:
            report = purge_unsupported_equities(connection, apply=args.apply)
        print(json.dumps(report, separators=(",", ":"), sort_keys=True))
        return 0
    except (OSError, RuntimeError, psycopg.Error, ValueError):
        print(json.dumps({"status": "failed", "errorCode": "purge_failed"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
