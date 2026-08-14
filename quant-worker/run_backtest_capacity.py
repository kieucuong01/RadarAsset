from __future__ import annotations

import argparse
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from time import perf_counter
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row

from backtest.capacity import build_capacity_report
from worker import PostgresWorkerRepository, process_next_run


def _database_url() -> str:
    raw = os.getenv("TEST_DATABASE_URL")
    if not raw:
        raise RuntimeError("TEST_DATABASE_URL is required.")
    parts = urlsplit(raw)
    database = parts.path.lstrip("/")
    if parts.hostname not in {"localhost", "127.0.0.1", "::1"} or not database.endswith("_test"):
        raise RuntimeError("Capacity runs require a local database ending in _test.")
    query = urlencode([(key, value) for key, value in parse_qsl(parts.query) if key != "schema"])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _seed(database_url: str, count: int) -> tuple[list[str], list[str]]:
    organization_ids = [str(uuid4()), str(uuid4())]
    run_ids = [str(uuid4()) for _ in range(count)]
    with psycopg.connect(database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT asset.id AS asset_id, asset.symbol, asset.market, asset.currency,
                       version.id AS dataset_version_id, strategy.id AS strategy_version_id,
                       strategy.implementation_hash
                FROM assets AS asset
                JOIN datasets AS dataset ON dataset.asset_id = asset.id AND dataset.timeframe = '1d'
                JOIN dataset_versions AS version ON version.dataset_id = dataset.id AND version.is_active
                CROSS JOIN LATERAL (
                  SELECT id, implementation_hash FROM strategy_versions
                  WHERE code = 'ma_crossover' AND version = '1.0.0' AND status = 'active'
                  LIMIT 1
                ) AS strategy
                WHERE asset.symbol = 'E2EBTC'
                LIMIT 1
                """
            )
            fixture = cursor.fetchone()
            if fixture is None:
                raise RuntimeError("Run scripts/seed-quant-e2e.ts before the capacity harness.")
            cursor.executemany(
                "INSERT INTO organizations (id, name, slug, created_at) VALUES (%s, %s, %s, NOW())",
                [
                    (organization_id, f"Capacity {index}", f"capacity-{uuid4().hex}")
                    for index, organization_id in enumerate(organization_ids)
                ],
            )
            for index, run_id in enumerate(run_ids):
                organization_id = organization_ids[index % len(organization_ids)]
                params = {
                    "timeframe": "1d",
                    "from": "2026-04-15",
                    "to": "2026-08-13",
                    "totalCapital": 100000 + index,
                    "allocationMode": "custom",
                    "feeBps": 10,
                    "slippageBps": 5,
                    "assumptions": {
                        "cashAllocationBps": 0,
                        "rebalanceFrequency": "none",
                        "monthlyContribution": 0,
                        "dividendMode": "exclude",
                        "fxPolicy": "normalized_returns",
                        "baseCurrency": "USD",
                        "marketCosts": {
                            market: {
                                "commissionBps": 10,
                                "sellTaxBps": 10 if market == "vn_equity" else 0,
                                "slippageBps": 5,
                                "financingBpsAnnual": 0,
                            }
                            for market in ("vn_equity", "crypto_spot", "metal_spot")
                        },
                    },
                    "legs": [
                        {
                            "symbol": fixture["symbol"],
                            "allocationBps": 10000,
                            "leverage": 1,
                            "strategyCode": "ma_crossover",
                            "strategyVersion": "1.0.0",
                            "strategyParameters": {"fastPeriod": 10, "slowPeriod": 30},
                        }
                    ],
                }
                cursor.execute(
                    """
                    INSERT INTO quant_runs (
                      id, organization_id, strategy_version_id, strategy_name, status, progress,
                      strategy_hash, dataset_version_ids, engine_version, parameters,
                      deadline_at, created_at
                    ) VALUES (%s, %s, %s, 'Portfolio Backtest', 'queued', 0, %s, %s::jsonb,
                              'capacity-v1', %s::jsonb, clock_timestamp() + INTERVAL '5 minutes',
                              clock_timestamp())
                    """,
                    (
                        run_id,
                        organization_id,
                        fixture["strategy_version_id"],
                        f"capacity-{index}",
                        json.dumps([str(fixture["dataset_version_id"])]),
                        json.dumps(params, separators=(",", ":")),
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO quant_run_legs (
                      id, quant_run_id, asset_id, dataset_version_id, strategy_version_id,
                      symbol_snapshot, market_snapshot, currency_snapshot, allocation_bps,
                      initial_notional, leverage, parameters, implementation_hash, status, progress,
                      created_at
                    ) VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, 10000, %s, 1,
                              '{"fastPeriod":10,"slowPeriod":30}'::jsonb, %s, 'queued', 0, NOW())
                    """,
                    (
                        run_id,
                        fixture["asset_id"],
                        fixture["dataset_version_id"],
                        fixture["strategy_version_id"],
                        fixture["symbol"],
                        fixture["market"],
                        fixture["currency"],
                        100000 + index,
                        fixture["implementation_hash"],
                    ),
                )
        connection.commit()
    return organization_ids, run_ids


def run_capacity(count: int, workers: int) -> dict[str, object]:
    database_url = _database_url()
    organization_ids, run_ids = _seed(database_url, count)
    started = perf_counter()

    def process(index: int) -> dict[str, object]:
        with psycopg.connect(database_url, autocommit=False) as connection:
            repository = PostgresWorkerRepository(connection, worker_id=f"capacity-{index}")
            return process_next_run(repository)

    try:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            results = list(executor.map(process, range(count)))
        elapsed = perf_counter() - started
        with psycopg.connect(database_url) as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    SELECT id::text, status,
                           EXTRACT(EPOCH FROM (started_at - created_at)) AS queue_seconds,
                           EXTRACT(EPOCH FROM (finished_at - started_at)) AS run_seconds,
                           attempt_count
                    FROM quant_runs WHERE id = ANY(%s::uuid[])
                    """,
                    (run_ids,),
                )
                rows = [dict(row) for row in cursor.fetchall()]
                cursor.execute(
                    """
                    SELECT count(*) FROM quant_run_artifacts AS artifact
                    JOIN quant_runs AS run ON run.id = artifact.quant_run_id
                    WHERE run.id = ANY(%s::uuid[])
                      AND artifact.organization_id <> run.organization_id
                    """,
                    (run_ids,),
                )
                violations = int(cursor.fetchone()["count"])
        if len(rows) != count or any(row["status"] != "succeeded" for row in rows):
            raise RuntimeError(f"Capacity run terminal failure: {results}")
        return build_capacity_report(
            requested=count,
            workers=workers,
            rows=rows,
            artifact_ownership_violations=violations,
            elapsed_seconds=elapsed,
            retries=sum(max(0, int(row["attempt_count"]) - 1) for row in rows),
        )
    finally:
        with psycopg.connect(database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM organizations WHERE id = ANY(%s::uuid[])", (organization_ids,))
            connection.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure production-path Quant backtest capacity.")
    parser.add_argument("--runs", type=int, choices=(20, 50), required=True)
    parser.add_argument("--workers", type=int, default=10)
    args = parser.parse_args()
    if args.workers < 1 or args.workers > args.runs:
        parser.error("workers must be between one and the number of runs")
    report = run_capacity(args.runs, args.workers)
    report["measuredAt"] = datetime.now(timezone.utc).isoformat()
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
