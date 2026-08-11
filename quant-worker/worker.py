from __future__ import annotations

import json
import os
import socket
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Protocol
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg.rows import dict_row

from backtest.engine import EngineConfig, artifact_checksum, run_strategy
from backtest.models import Bar
from backtest.quality import canonical_bar_checksum
from backtest.strategies import (
    AbcdCausalStrategy,
    MovingAverageCrossoverStrategy,
    SignalRollingReversalStrategy,
    Strategy,
    TurtleBreakoutStrategy,
)


DEFAULT_DATABASE_URL = (
    "postgresql://postgres:postgres@localhost:5432/quant_insight_radar?schema=public"
)
DEFAULT_LEASE_SECONDS = 300
MAX_ATTEMPTS = 3


@dataclass(frozen=True)
class QueuedRun:
    id: str
    organization_id: str
    strategy_hash: str
    parameters: dict[str, Any]
    dataset_version_ids: tuple[str, ...]
    worker_id: str = ""
    attempt_count: int = 0


@dataclass(frozen=True)
class DatasetInput:
    version_id: str
    asset: str
    market: str
    checksum: str
    bars: list[Bar]


class WorkerRepository(Protocol):
    def claim_next_run(self) -> QueuedRun | None: ...

    def load_datasets(self, run: QueuedRun) -> list[DatasetInput]: ...

    def complete_run(
        self,
        run: QueuedRun,
        summary: dict[str, Any],
        artifacts: list[dict[str, Any]],
    ) -> None: ...

    def fail_run(self, run: QueuedRun, code: str, message: str) -> None: ...


def load_local_env(path: str = ".env.local") -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def database_url() -> str:
    load_local_env()
    raw_url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
    parts = urlsplit(raw_url)
    query = urlencode([(key, value) for key, value in parse_qsl(parts.query) if key != "schema"])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _engine_config(run: QueuedRun, datasets: list[DatasetInput]) -> EngineConfig:
    parameters = run.parameters
    common_keys = {
        "timeframe",
        "initialCapital",
        "feeBps",
        "slippageBps",
        "from",
        "to",
        "legs",
    }
    legacy_keys = common_keys | {"strategy", "fastPeriod", "slowPeriod"}
    catalog_keys = common_keys | {"strategyCode", "strategyVersion", "strategyParameters"}
    if set(parameters) == catalog_keys:
        if parameters.get("strategyVersion") != "1.0.0":
            raise ValueError("Unsupported strategy version.")
        strategy_parameters = parameters.get("strategyParameters")
        if not isinstance(strategy_parameters, dict):
            raise ValueError("Strategy parameters do not match the allow-listed contract.")
        strategy, fast_period, slow_period = _catalog_strategy(
            str(parameters.get("strategyCode")), strategy_parameters
        )
    elif set(parameters) == legacy_keys and parameters.get("strategy") == "ma_cross":
        fast_period = _strict_int(parameters["fastPeriod"], "fastPeriod", 2, 200)
        slow_period = _strict_int(parameters["slowPeriod"], "slowPeriod", 3, 400)
        if fast_period >= slow_period:
            raise ValueError("MA periods are invalid.")
        strategy = MovingAverageCrossoverStrategy(fast_period=fast_period, slow_period=slow_period)
    else:
        raise ValueError("Backtest parameters do not match the allow-listed strategy contract.")
    timeframe = parameters.get("timeframe")
    if timeframe not in {"1d", "1h"}:
        raise ValueError("Unsupported timeframe.")
    legs = parameters.get("legs")
    if not isinstance(legs, list) or not 1 <= len(legs) <= 3:
        raise ValueError("Backtest legs are invalid.")
    leverage_by_asset: dict[str, Decimal] = {}
    for leg in legs:
        if not isinstance(leg, dict) or set(leg) != {"symbol", "leverage"}:
            raise ValueError("Backtest leg is invalid.")
        symbol = leg.get("symbol")
        if symbol not in {"FPT", "BTC", "XAU"} or symbol in leverage_by_asset:
            raise ValueError("Backtest asset is invalid or duplicated.")
        leverage_by_asset[str(symbol)] = Decimal(str(leg.get("leverage")))
    dataset_assets = {dataset.asset for dataset in datasets}
    if dataset_assets != set(leverage_by_asset):
        raise ValueError("Selected datasets do not match the run assets.")
    if any(any(bar.timeframe != timeframe for bar in dataset.bars) for dataset in datasets):
        raise ValueError("Dataset timeframe does not match the run timeframe.")
    return EngineConfig(
        initial_capital=Decimal(str(parameters["initialCapital"])),
        fast_period=fast_period,
        slow_period=slow_period,
        fee_bps=Decimal(str(parameters["feeBps"])),
        slippage_bps=Decimal(str(parameters["slippageBps"])),
        leverage_by_asset=leverage_by_asset,
        market_by_asset={dataset.asset: dataset.market for dataset in datasets},
        strategy_hash=run.strategy_hash,
        dataset_checksums={dataset.asset: dataset.checksum for dataset in datasets},
        strategy=strategy,
    )


def _strict_int(value: object, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{name} is invalid.")
    return value


def _strict_decimal(value: object, name: str, minimum: str, maximum: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} is invalid.")
    decimal = Decimal(str(value))
    if not Decimal(minimum) <= decimal <= Decimal(maximum):
        raise ValueError(f"{name} is invalid.")
    return decimal


def _catalog_strategy(
    code: str, parameters: dict[str, Any]
) -> tuple[Strategy, int, int]:
    if code == "ma_crossover":
        if set(parameters) != {"fastPeriod", "slowPeriod"}:
            raise ValueError("Strategy parameters do not match the MA contract.")
        fast_period = _strict_int(parameters["fastPeriod"], "fastPeriod", 2, 200)
        slow_period = _strict_int(parameters["slowPeriod"], "slowPeriod", 3, 400)
        if fast_period >= slow_period:
            raise ValueError("MA periods are invalid.")
        strategy = MovingAverageCrossoverStrategy(fast_period, slow_period)
        return strategy, fast_period, slow_period
    if code == "turtle_breakout":
        if set(parameters) != {"entryPeriod", "exitPeriod"}:
            raise ValueError("Strategy parameters do not match the Turtle contract.")
        entry_period = _strict_int(parameters["entryPeriod"], "entryPeriod", 2, 250)
        exit_period = _strict_int(parameters["exitPeriod"], "exitPeriod", 2, 250)
        strategy = TurtleBreakoutStrategy(entry_period, exit_period)
        return strategy, 2, max(3, strategy.warmup_bars)
    if code == "signal_rolling_reversal":
        if set(parameters) != {"confirmationBars"}:
            raise ValueError("Strategy parameters do not match the rolling contract.")
        confirmation_bars = _strict_int(parameters["confirmationBars"], "confirmationBars", 2, 20)
        strategy = SignalRollingReversalStrategy(confirmation_bars)
        return strategy, 2, max(3, strategy.warmup_bars)
    if code == "abcd_causal":
        required = {
            "pivotLeftBars",
            "pivotRightBars",
            "retracementMin",
            "retracementMax",
            "extensionMin",
            "extensionMax",
        }
        if set(parameters) != required:
            raise ValueError("Strategy parameters do not match the ABCD contract.")
        pivot_left = _strict_int(parameters["pivotLeftBars"], "pivotLeftBars", 1, 10)
        pivot_right = _strict_int(parameters["pivotRightBars"], "pivotRightBars", 1, 10)
        retracement_min = _strict_decimal(parameters["retracementMin"], "retracementMin", "0.1", "1.5")
        retracement_max = _strict_decimal(parameters["retracementMax"], "retracementMax", "0.2", "2")
        extension_min = _strict_decimal(parameters["extensionMin"], "extensionMin", "0.5", "3")
        extension_max = _strict_decimal(parameters["extensionMax"], "extensionMax", "0.75", "4")
        strategy = AbcdCausalStrategy(
            pivot_left,
            pivot_right,
            retracement_min,
            retracement_max,
            extension_min,
            extension_max,
        )
        return strategy, 2, max(3, strategy.warmup_bars)
    raise ValueError("Unsupported strategy code.")


def bars_in_run_range(bars: list[Bar], run: QueuedRun) -> list[Bar]:
    start = run.parameters.get("from")
    end = run.parameters.get("to")
    if not isinstance(start, str) or not isinstance(end, str):
        raise ValueError("Backtest date range is invalid.")
    try:
        start_date = datetime.strptime(start, "%Y-%m-%d").date()
        end_date = datetime.strptime(end, "%Y-%m-%d").date()
    except ValueError as error:
        raise ValueError("Backtest date range is invalid.") from error
    if start_date > end_date:
        raise ValueError("Backtest date range is invalid.")
    return [row for row in bars if start_date <= row.timestamp.date() <= end_date]


def process_next_run(repository: WorkerRepository) -> dict[str, Any]:
    run = repository.claim_next_run()
    if run is None:
        return {"status": "idle", "message": "No queued backtest runs."}
    try:
        datasets = repository.load_datasets(run)
        if len(datasets) != len(run.dataset_version_ids):
            repository.fail_run(run, "DATASET_INCOMPLETE", "Selected dataset versions are unavailable.")
            return {"status": "failed", "id": run.id, "code": "DATASET_INCOMPLETE"}
        for dataset in datasets:
            if canonical_bar_checksum(dataset.bars) != dataset.checksum:
                repository.fail_run(
                    run,
                    "DATASET_CHECKSUM_MISMATCH",
                    "Dataset checksum verification failed.",
                )
                return {
                    "status": "failed",
                    "id": run.id,
                    "code": "DATASET_CHECKSUM_MISMATCH",
                }
        execution_datasets = [
            DatasetInput(
                version_id=dataset.version_id,
                asset=dataset.asset,
                market=dataset.market,
                checksum=dataset.checksum,
                bars=bars_in_run_range(dataset.bars, run),
            )
            for dataset in datasets
        ]
        config = _engine_config(run, execution_datasets)
        result = run_strategy(
            {dataset.asset: dataset.bars for dataset in execution_datasets},
            config,
            strategy=config.strategy,
        )
        manifest = {
            **result.manifest,
            "runId": run.id,
            "datasetVersionIds": list(run.dataset_version_ids),
        }
        artifact_payloads = [
            ("equity", result.equity),
            ("drawdown", result.drawdown),
            ("trades", result.trades),
            ("manifest", manifest),
        ]
        artifacts = [
            {
                "kind": kind,
                "checksum": artifact_checksum(payload),
                "payload": payload,
                "rowCount": len(payload) if isinstance(payload, list) else 1,
                "schemaVersion": 1,
            }
            for kind, payload in artifact_payloads
        ]
        repository.complete_run(run, result.summary, artifacts)
        return {"status": "succeeded", "id": run.id, "metrics": result.summary}
    except ValueError:
        repository.fail_run(run, "DSL_INVALID", "Backtest configuration is invalid.")
        return {"status": "failed", "id": run.id, "code": "DSL_INVALID"}
    except Exception:
        repository.fail_run(run, "ENGINE_FAILED", "Backtest execution failed.")
        return {"status": "failed", "id": run.id, "code": "ENGINE_FAILED"}


class PostgresWorkerRepository:
    def __init__(
        self,
        connection: psycopg.Connection[Any],
        *,
        worker_id: str | None = None,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
    ) -> None:
        if lease_seconds < 1:
            raise ValueError("Worker lease seconds must be positive.")
        self.connection = connection
        self.worker_id = worker_id or os.getenv(
            "QUANT_WORKER_ID", f"{socket.gethostname()}-{uuid.uuid4().hex[:12]}"
        )
        self.lease_seconds = lease_seconds

    def claim_next_run(self) -> QueuedRun | None:
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                WITH next_run AS (
                  SELECT id
                  FROM quant_runs
                  WHERE (
                    status = 'queued'
                    OR (
                      status = 'running'
                      AND lease_expires_at IS NOT NULL
                      AND lease_expires_at <= NOW()
                      AND attempt_count < %s
                    )
                  )
                  AND (strategy_version_id IS NOT NULL OR strategy_name = 'MA Crossover Backtest')
                  ORDER BY created_at ASC
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
                )
                UPDATE quant_runs AS run
                SET status = 'running',
                    progress = GREATEST(progress, 5),
                    started_at = COALESCE(started_at, NOW()),
                    error_message = NULL,
                    worker_id = %s,
                    lease_expires_at = NOW() + (%s * INTERVAL '1 second'),
                    attempt_count = attempt_count + 1
                FROM next_run
                WHERE run.id = next_run.id
                RETURNING run.id, run.organization_id, run.strategy_hash,
                          run.parameters, run.dataset_version_ids,
                          run.worker_id, run.attempt_count
                """
                ,
                (MAX_ATTEMPTS, self.worker_id, self.lease_seconds),
            )
            row = cursor.fetchone()
        if row is None:
            return None
        return QueuedRun(
            id=str(row["id"]),
            organization_id=str(row["organization_id"]),
            strategy_hash=str(row["strategy_hash"] or ""),
            parameters=dict(row["parameters"] or {}),
            dataset_version_ids=tuple(str(value) for value in (row["dataset_version_ids"] or [])),
            worker_id=str(row["worker_id"] or ""),
            attempt_count=int(row["attempt_count"] or 0),
        )

    def load_datasets(self, run: QueuedRun) -> list[DatasetInput]:
        if not run.dataset_version_ids:
            return []
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT version.id AS version_id, version.checksum,
                       asset.symbol, asset.market,
                       bar.ts, bar.open, bar.high, bar.low, bar.close, bar.volume,
                       bar.source, dataset.timeframe
                FROM dataset_versions AS version
                JOIN datasets AS dataset ON dataset.id = version.dataset_id
                JOIN assets AS asset ON asset.id = dataset.asset_id
                JOIN dataset_bars AS bar ON bar.dataset_version_id = version.id
                WHERE version.id = ANY(%s::uuid[])
                ORDER BY asset.symbol ASC, bar.ts ASC
                """,
                (list(run.dataset_version_ids),),
            )
            rows = cursor.fetchall()
        grouped: dict[str, DatasetInput] = {}
        for row in rows:
            version_id = str(row["version_id"])
            bar = Bar(
                asset=str(row["symbol"]),
                timestamp=row["ts"].replace(tzinfo=row["ts"].tzinfo or timezone.utc),
                timeframe=str(row["timeframe"]),
                open=Decimal(str(row["open"])),
                high=Decimal(str(row["high"])),
                low=Decimal(str(row["low"])),
                close=Decimal(str(row["close"])),
                volume=None if row["volume"] is None else Decimal(str(row["volume"])),
                source=str(row["source"]),
            )
            existing = grouped.get(version_id)
            if existing is None:
                grouped[version_id] = DatasetInput(
                    version_id=version_id,
                    asset=str(row["symbol"]),
                    market=str(row["market"]),
                    checksum=str(row["checksum"]),
                    bars=[bar],
                )
            else:
                existing.bars.append(bar)
        return [grouped[version_id] for version_id in run.dataset_version_ids if version_id in grouped]

    def complete_run(
        self,
        run: QueuedRun,
        summary: dict[str, Any],
        artifacts: list[dict[str, Any]],
    ) -> None:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE quant_runs
                SET status = 'succeeded', progress = 100, metrics = %s::jsonb,
                    error_message = NULL, finished_at = NOW(), lease_expires_at = NULL
                WHERE id = %s AND organization_id = %s AND status = 'running'
                  AND worker_id = %s AND lease_expires_at > NOW()
                RETURNING id
                """,
                (
                    json.dumps(summary, separators=(",", ":")),
                    run.id,
                    run.organization_id,
                    run.worker_id,
                ),
            )
            if cursor.fetchone() is None:
                return
            cursor.execute(
                "DELETE FROM quant_run_artifacts WHERE quant_run_id = %s AND organization_id = %s",
                (run.id, run.organization_id),
            )
            for artifact in artifacts:
                cursor.execute(
                    """
                    INSERT INTO quant_run_artifacts (
                        id, organization_id, quant_run_id, kind, checksum,
                        payload, row_count, schema_version, created_at
                    ) VALUES (
                        gen_random_uuid(), %s, %s, %s, %s, %s::jsonb, %s, %s, NOW()
                    )
                    """,
                    (
                        run.organization_id,
                        run.id,
                        artifact["kind"],
                        artifact["checksum"],
                        json.dumps(artifact["payload"], separators=(",", ":")),
                        artifact["rowCount"],
                        artifact["schemaVersion"],
                    ),
                )
    def fail_run(self, run: QueuedRun, code: str, message: str) -> None:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE quant_runs
                SET status = 'failed', progress = 100, error_message = %s,
                    finished_at = NOW(), lease_expires_at = NULL
                WHERE id = %s AND organization_id = %s AND status = 'running'
                  AND worker_id = %s AND lease_expires_at > NOW()
                """,
                (f"{code}: {message}", run.id, run.organization_id, run.worker_id),
            )


def run_once() -> dict[str, Any]:
    with psycopg.connect(database_url(), autocommit=False) as connection:
        repository = PostgresWorkerRepository(connection)
        result = process_next_run(repository)
        connection.commit()
        return result


def main() -> None:
    print(f"[{datetime.now(timezone.utc).isoformat()}] Quant worker booting")
    print(json.dumps(run_once(), indent=2))


if __name__ == "__main__":
    main()
