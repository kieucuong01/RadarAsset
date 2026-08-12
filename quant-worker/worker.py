from __future__ import annotations

import json
import os
import socket
import time
import uuid
from argparse import ArgumentParser
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Protocol, Sequence
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg.rows import dict_row

from backtest.engine import EngineConfig, artifact_checksum, run_strategy
from backtest.analytics import build_performance_analytics
from backtest.custom_execution import run_price_threshold, run_scheduled_dca
from backtest.custom_rules import (
    PriceThresholdRule,
    ScheduledDcaRule,
    custom_rule_implementation_hash,
    parse_custom_rule,
)
from backtest.models import Bar
from backtest.portfolio import (
    PortfolioAssumptions,
    PortfolioLegInput,
    run_portfolio,
)
from backtest.quality import canonical_bar_checksum
from backtest.strategies import MovingAverageCrossoverStrategy, Strategy
from backtest.strategy_factory import strategy_from_catalog


DEFAULT_DATABASE_URL = (
    "postgresql://postgres:postgres@localhost:5432/quant_insight_radar?schema=public"
)
DEFAULT_LEASE_SECONDS = 300
MAX_ATTEMPTS = 3


@dataclass(frozen=True)
class QueuedRunLeg:
    id: str
    asset: str
    market: str
    dataset_version_id: str
    allocation_bps: int
    initial_notional: Decimal
    leverage: Decimal
    strategy_code: str
    strategy_version: str
    strategy_parameters: dict[str, Any]
    implementation_hash: str = ""


@dataclass(frozen=True)
class QueuedRun:
    id: str
    organization_id: str
    strategy_hash: str
    parameters: dict[str, Any]
    dataset_version_ids: tuple[str, ...]
    worker_id: str = ""
    attempt_count: int = 0
    legs: tuple[QueuedRunLeg, ...] = ()


@dataclass(frozen=True)
class DatasetInput:
    version_id: str
    asset: str
    market: str
    checksum: str
    bars: list[Bar]
    adjustment_policy: str = "raw"


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
    strategy = strategy_from_catalog(code, "1.0.0", parameters)
    fast_period = getattr(strategy, "fast_period", 2)
    slow_period = getattr(strategy, "slow_period", max(3, strategy.warmup_bars))
    return strategy, fast_period, slow_period


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


def _portfolio_assumptions(parameters: dict[str, Any]) -> PortfolioAssumptions:
    raw = parameters.get("assumptions")
    if not isinstance(raw, dict) or set(raw) != {
        "cashAllocationBps",
        "rebalanceFrequency",
        "monthlyContribution",
        "dividendMode",
        "fxPolicy",
        "baseCurrency",
        "marketCosts",
    }:
        raise ValueError("Portfolio assumptions are invalid.")
    costs = raw.get("marketCosts")
    if not isinstance(costs, dict) or set(costs) != {
        "vn_equity",
        "crypto_spot",
        "metal_spot",
    }:
        raise ValueError("Portfolio market costs are invalid.")
    parsed_costs: dict[str, dict[str, Decimal]] = {}
    required_costs = {
        "commissionBps",
        "sellTaxBps",
        "slippageBps",
        "financingBpsAnnual",
    }
    for market, raw_cost in costs.items():
        if not isinstance(raw_cost, dict) or set(raw_cost) != required_costs:
            raise ValueError("Portfolio market costs are invalid.")
        parsed_costs[market] = {
            key: _strict_decimal(value, key, "0", "10000")
            for key, value in raw_cost.items()
        }
    cash_bps = raw.get("cashAllocationBps")
    if isinstance(cash_bps, bool) or not isinstance(cash_bps, int) or not 0 <= cash_bps <= 10_000:
        raise ValueError("Portfolio cash allocation is invalid.")
    contribution = raw.get("monthlyContribution")
    if isinstance(contribution, bool) or not isinstance(contribution, (int, float)):
        raise ValueError("Portfolio contribution is invalid.")
    return PortfolioAssumptions(
        cash_allocation_bps=cash_bps,
        rebalance_frequency=str(raw.get("rebalanceFrequency")),
        monthly_contribution=Decimal(str(contribution)),
        dividend_mode=str(raw.get("dividendMode")),
        fx_policy=str(raw.get("fxPolicy")),
        base_currency=str(raw.get("baseCurrency")),
        market_costs=parsed_costs,
    )


def _artifact(
    kind: str,
    payload: object,
    *,
    scope_key: str = "aggregate",
    leg_id: str | None = None,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "kind": kind,
        "checksum": artifact_checksum(payload),
        "payload": payload,
        "rowCount": len(payload) if isinstance(payload, list) else 1,
        "schemaVersion": 1,
        "scopeKey": scope_key,
        "quantRunLegId": leg_id,
        "metrics": metrics,
    }


def _performance_artifacts(
    equity: list[dict[str, Any]],
    *,
    markets: list[str],
    timeframe: str,
    title: str,
) -> list[dict[str, Any]]:
    if len(equity) < 31:
        return []
    report = build_performance_analytics(
        equity,
        markets=markets,
        timeframe=timeframe,
        title=title,
    )
    return [
        _artifact("analytics", report.metrics),
        _artifact("report_html", report.html),
    ]


def _process_portfolio_run(
    run: QueuedRun, datasets: list[DatasetInput]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    parameters = run.parameters
    if set(parameters) != {
        "timeframe",
        "from",
        "to",
        "totalCapital",
        "allocationMode",
        "feeBps",
        "slippageBps",
        "assumptions",
        "legs",
    }:
        raise ValueError("Portfolio parameters do not match the allow-listed contract.")
    total_capital = _strict_decimal(parameters["totalCapital"], "totalCapital", "0.00000001", "100000000000")
    assumptions = _portfolio_assumptions(parameters)
    timeframe = parameters.get("timeframe")
    if timeframe not in {"1d", "1h"}:
        raise ValueError("Unsupported timeframe.")
    raw_legs = parameters.get("legs")
    if not isinstance(raw_legs, list) or not 1 <= len(raw_legs) <= 10:
        raise ValueError("Portfolio legs are invalid.")
    request_by_symbol = {
        str(item.get("symbol")): item for item in raw_legs if isinstance(item, dict)
    }
    if len(request_by_symbol) != len(raw_legs) or len(run.legs) != len(raw_legs):
        raise ValueError("Portfolio legs are invalid or duplicated.")
    dataset_by_id = {dataset.version_id: dataset for dataset in datasets}
    portfolio_legs: list[PortfolioLegInput] = []
    artifacts: list[dict[str, Any]] = []
    for leg in sorted(run.legs, key=lambda item: item.asset):
        requested = request_by_symbol.get(leg.asset)
        dataset = dataset_by_id.get(leg.dataset_version_id)
        if requested is None or dataset is None or dataset.asset != leg.asset or dataset.market != leg.market:
            raise ValueError("Resolved portfolio leg does not match immutable data.")
        expected_keys = {
            "symbol",
            "allocationBps",
            "leverage",
            "strategyCode",
            "strategyVersion",
            "strategyParameters",
        }
        if set(requested) != expected_keys:
            raise ValueError("Portfolio leg parameters are invalid.")
        if (
            requested["allocationBps"] != leg.allocation_bps
            or Decimal(str(requested["leverage"])) != leg.leverage
            or requested["strategyCode"] != leg.strategy_code
            or requested["strategyVersion"] != leg.strategy_version
            or requested["strategyParameters"] != leg.strategy_parameters
        ):
            raise ValueError("Portfolio leg metadata mismatch.")
        if leg.strategy_version != "1.0.0":
            raise ValueError("Unsupported strategy version.")
        cost = assumptions.market_costs[leg.market]
        execution_capital = leg.initial_notional if leg.initial_notional > 0 else Decimal("1")
        custom_contributions: list[dict[str, Any]] = []
        custom_cash_flow: list[dict[str, Any]] = []
        if leg.strategy_code.startswith("custom:"):
            if custom_rule_implementation_hash(leg.strategy_parameters) != leg.implementation_hash:
                raise ValueError("Custom strategy hash mismatch.")
            rule = parse_custom_rule(leg.strategy_parameters)
            if isinstance(rule, PriceThresholdRule):
                result = run_price_threshold(
                    leg.asset,
                    dataset.bars,
                    initial_capital=execution_capital,
                    rule=rule,
                    fee_bps=cost["commissionBps"],
                    sell_tax_bps=cost["sellTaxBps"],
                    slippage_bps=cost["slippageBps"],
                    strategy_hash=run.strategy_hash,
                    dataset_checksum=dataset.checksum,
                )
            elif isinstance(rule, ScheduledDcaRule):
                custom = run_scheduled_dca(
                    leg.asset,
                    dataset.bars,
                    initial_capital=execution_capital,
                    rule=rule,
                    fee_bps=cost["commissionBps"],
                    slippage_bps=cost["slippageBps"],
                    strategy_hash=run.strategy_hash,
                    dataset_checksum=dataset.checksum,
                )
                result = custom.result
                custom_contributions = custom.contributions
                custom_cash_flow = custom.cash_flow
            else:
                raise ValueError("Unsupported custom strategy.")
            result.manifest["strategyCode"] = leg.strategy_code
            result.manifest["strategyVersion"] = leg.strategy_version
        else:
            strategy, fast_period, slow_period = _catalog_strategy(
                leg.strategy_code, leg.strategy_parameters
            )
            result = run_strategy(
                {leg.asset: dataset.bars},
                EngineConfig(
                    initial_capital=execution_capital,
                    fast_period=fast_period,
                    slow_period=slow_period,
                    fee_bps=cost["commissionBps"],
                    slippage_bps=cost["slippageBps"],
                    leverage_by_asset={leg.asset: leg.leverage},
                    market_by_asset={leg.asset: leg.market},
                    strategy_hash=run.strategy_hash,
                    dataset_checksums={leg.asset: dataset.checksum},
                    strategy=strategy,
                    sell_tax_bps=cost["sellTaxBps"],
                    financing_bps_annual=cost["financingBpsAnnual"],
                ),
                strategy=strategy,
            )
        leg_manifest = {
            **result.manifest,
            "runId": run.id,
            "legId": leg.id,
            "datasetVersionId": dataset.version_id,
            "adjustmentPolicy": dataset.adjustment_policy,
        }
        scope_key = f"leg:{leg.id}"
        leg_payloads = [
            ("equity", result.equity),
            ("drawdown", result.drawdown),
            ("trades", result.trades),
            ("manifest", leg_manifest),
        ]
        if custom_contributions:
            leg_payloads.append(("contribution", custom_contributions))
        if custom_cash_flow:
            leg_payloads.append(("cash_flow", custom_cash_flow))
        for kind, payload in leg_payloads:
            artifacts.append(
                _artifact(
                    kind,
                    payload,
                    scope_key=scope_key,
                    leg_id=leg.id,
                    metrics=result.summary if kind == "manifest" else None,
                )
            )
        portfolio_legs.append(
            PortfolioLegInput(
                id=leg.id,
                symbol=leg.asset,
                market=leg.market,
                allocation_bps=leg.allocation_bps,
                initial_notional=leg.initial_notional,
                dataset_checksum=dataset.checksum,
                adjustment_policy=dataset.adjustment_policy,
                result=result,
            )
        )
    portfolio = run_portfolio(
        portfolio_legs,
        total_capital=total_capital,
        assumptions=assumptions,
        portfolio_hash=run.strategy_hash,
    )
    aggregate_manifest = {
        **portfolio.manifest,
        "runId": run.id,
        "datasetVersionIds": list(run.dataset_version_ids),
    }
    for kind, payload in (
        ("equity", portfolio.equity),
        ("drawdown", portfolio.drawdown),
        ("contribution", portfolio.contribution),
        ("cash_flow", portfolio.cash_flow),
        ("rebalance", portfolio.rebalance),
        ("manifest", aggregate_manifest),
    ):
        artifacts.append(_artifact(kind, payload))
    artifacts.extend(
        _performance_artifacts(
            portfolio.equity,
            markets=[leg.market for leg in portfolio_legs],
            timeframe=timeframe,
            title="Portfolio backtest",
        )
    )
    return portfolio.summary, artifacts


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
                adjustment_policy=dataset.adjustment_policy,
            )
            for dataset in datasets
        ]
        if run.legs:
            summary, artifacts = _process_portfolio_run(run, execution_datasets)
        else:
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
            artifacts = [
                _artifact(kind, payload)
                for kind, payload in (
                    ("equity", result.equity),
                    ("drawdown", result.drawdown),
                    ("trades", result.trades),
                    ("manifest", manifest),
                )
            ]
            artifacts.extend(
                _performance_artifacts(
                    result.equity,
                    markets=[dataset.market for dataset in execution_datasets],
                    timeframe=str(run.parameters.get("timeframe", "1d")),
                    title=f"{config.strategy.code} backtest",
                )
            )
            summary = result.summary
        repository.complete_run(run, summary, artifacts)
        return {"status": "succeeded", "id": run.id, "metrics": summary}
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
                  AND (
                    strategy_version_id IS NOT NULL
                    OR strategy_name = 'MA Crossover Backtest'
                    OR EXISTS (
                      SELECT 1 FROM quant_run_legs AS leg WHERE leg.quant_run_id = quant_runs.id
                    )
                  )
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
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT leg.id, asset.symbol, asset.market, leg.dataset_version_id,
                       leg.allocation_bps, leg.initial_notional, leg.leverage,
                       strategy.code AS strategy_code, strategy.version AS strategy_version,
                       leg.parameters, leg.implementation_hash
                FROM quant_run_legs AS leg
                JOIN assets AS asset ON asset.id = leg.asset_id
                JOIN strategy_versions AS strategy ON strategy.id = leg.strategy_version_id
                WHERE leg.quant_run_id = %s
                ORDER BY asset.symbol ASC
                """,
                (row["id"],),
            )
            leg_rows = cursor.fetchall()
        return QueuedRun(
            id=str(row["id"]),
            organization_id=str(row["organization_id"]),
            strategy_hash=str(row["strategy_hash"] or ""),
            parameters=dict(row["parameters"] or {}),
            dataset_version_ids=tuple(str(value) for value in (row["dataset_version_ids"] or [])),
            worker_id=str(row["worker_id"] or ""),
            attempt_count=int(row["attempt_count"] or 0),
            legs=tuple(
                QueuedRunLeg(
                    id=str(leg["id"]),
                    asset=str(leg["symbol"]),
                    market=str(leg["market"]),
                    dataset_version_id=str(leg["dataset_version_id"]),
                    allocation_bps=int(leg["allocation_bps"]),
                    initial_notional=Decimal(str(leg["initial_notional"])),
                    leverage=Decimal(str(leg["leverage"])),
                    strategy_code=str(leg["strategy_code"]),
                    strategy_version=str(leg["strategy_version"]),
                    strategy_parameters=dict(leg["parameters"] or {}),
                    implementation_hash=str(leg["implementation_hash"] or ""),
                )
                for leg in leg_rows
            ),
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
                       bar.source, dataset.timeframe, dataset.adjustment_policy
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
                    adjustment_policy=str(row["adjustment_policy"]),
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
                leg_id = artifact.get("quantRunLegId")
                metrics = artifact.get("metrics")
                if leg_id is not None and metrics is not None:
                    cursor.execute(
                        """
                        UPDATE quant_run_legs
                        SET status = 'succeeded', progress = 100, metrics = %s::jsonb,
                            error_code = NULL
                        WHERE id = %s AND quant_run_id = %s
                        """,
                        (json.dumps(metrics, separators=(",", ":")), leg_id, run.id),
                    )
            for artifact in artifacts:
                cursor.execute(
                    """
                    INSERT INTO quant_run_artifacts (
                        id, organization_id, quant_run_id, quant_run_leg_id,
                        scope_key, kind, checksum, payload, row_count,
                        schema_version, created_at
                    ) VALUES (
                        gen_random_uuid(), %s, %s, %s, %s, %s, %s,
                        %s::jsonb, %s, %s, NOW()
                    )
                    """,
                    (
                        run.organization_id,
                        run.id,
                        artifact.get("quantRunLegId"),
                        artifact.get("scopeKey", "aggregate"),
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
            cursor.execute(
                """
                UPDATE quant_run_legs
                SET status = 'failed', progress = 100, error_code = %s
                WHERE quant_run_id = %s AND status IN ('queued', 'running')
                """,
                (code, run.id),
            )


def run_once() -> dict[str, Any]:
    with psycopg.connect(database_url(), autocommit=False) as connection:
        repository = PostgresWorkerRepository(connection)
        result = process_next_run(repository)
        connection.commit()
        return result


def run_forever(
    *,
    poll_seconds: float = 2.0,
    run_once_fn: Callable[[], dict[str, Any]] = run_once,
    sleep_fn: Callable[[float], None] = time.sleep,
    output_fn: Callable[[dict[str, Any]], None] | None = None,
) -> None:
    if poll_seconds <= 0:
        raise ValueError("Worker poll seconds must be positive.")
    emit = output_fn or (lambda result: print(json.dumps(result, indent=2), flush=True))
    while True:
        result = run_once_fn()
        if result.get("status") == "idle":
            sleep_fn(poll_seconds)
        else:
            emit(result)


def main(argv: Sequence[str] | None = None) -> int:
    parser = ArgumentParser(description="Process queued portfolio backtests.")
    parser.add_argument("--once", action="store_true", help="Process at most one queued run.")
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    args = parser.parse_args(argv)
    if args.poll_seconds <= 0:
        parser.error("--poll-seconds must be positive")
    print(f"[{datetime.now(timezone.utc).isoformat()}] Quant worker booting", flush=True)
    if args.once:
        print(json.dumps(run_once(), indent=2), flush=True)
        return 0
    try:
        run_forever(poll_seconds=args.poll_seconds)
    except KeyboardInterrupt:
        print("Quant worker stopped.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
