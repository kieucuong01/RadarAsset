from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime
from decimal import Decimal
from typing import Any, Callable

from backtest.analytics import build_performance_analytics
from backtest.custom_execution import run_price_threshold, run_scheduled_dca
from backtest.custom_rules import (
    PriceThresholdRule,
    ScheduledDcaRule,
    custom_rule_implementation_hash,
    parse_custom_rule,
)
from backtest.engine import EngineConfig, artifact_checksum, run_strategy
from backtest.models import Bar
from backtest.portfolio import PortfolioAssumptions, PortfolioLegInput, run_portfolio
from backtest.quality import canonical_bar_checksum
from backtest.robustness import (
    build_walk_forward_diagnostics,
    build_walk_forward_selection,
    combined_robustness_status,
    out_of_sample_return,
    parameter_neighbors,
    parameter_stability,
)
from backtest.run_contracts import DatasetInput, QueuedRun, WorkerRepository
from backtest.strategies import MovingAverageCrossoverStrategy, Strategy
from backtest.strategy_factory import strategy_from_catalog

class RunControlStop(Exception):
    def __init__(self, status: str) -> None:
        super().__init__(status)
        self.status = status


def _checkpoint(repository: WorkerRepository, run: QueuedRun, progress: int) -> None:
    status = repository.checkpoint_run(run, progress)
    if status != "running":
        raise RunControlStop(status)


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
    if timeframe != "1d":
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
    run: QueuedRun,
    datasets: list[DatasetInput],
    checkpoint: Callable[[int], None] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    parameters = run.parameters
    required_parameter_keys = {
        "timeframe",
        "from",
        "to",
        "totalCapital",
        "allocationMode",
        "feeBps",
        "slippageBps",
        "assumptions",
        "legs",
    }
    if set(parameters) not in {
        frozenset(required_parameter_keys),
        frozenset(required_parameter_keys | {"historicalCoverage"}),
    }:
        raise ValueError("Portfolio parameters do not match the allow-listed contract.")
    total_capital = _strict_decimal(parameters["totalCapital"], "totalCapital", "0.00000001", "100000000000")
    assumptions = _portfolio_assumptions(parameters)
    timeframe = parameters.get("timeframe")
    if timeframe != "1d":
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
    neighbor_leg_results: list[tuple[str, Any, str]] = []
    artifacts: list[dict[str, Any]] = []
    sorted_legs = sorted(run.legs, key=lambda item: item.asset)
    for leg_index, leg in enumerate(sorted_legs):
        if checkpoint is not None:
            checkpoint(20 + (leg_index * 50 // max(1, len(sorted_legs))))
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
            def execute_catalog(candidate: Strategy, candidate_fast: int, candidate_slow: int):
                return run_strategy(
                    {leg.asset: dataset.bars},
                    EngineConfig(
                        initial_capital=execution_capital,
                        fast_period=candidate_fast,
                        slow_period=candidate_slow,
                        fee_bps=cost["commissionBps"],
                        slippage_bps=cost["slippageBps"],
                        leverage_by_asset={leg.asset: leg.leverage},
                        market_by_asset={leg.asset: leg.market},
                        strategy_hash=run.strategy_hash,
                        dataset_checksums={leg.asset: dataset.checksum},
                        strategy=candidate,
                        sell_tax_bps=cost["sellTaxBps"],
                        financing_bps_annual=cost["financingBpsAnnual"],
                    ),
                    strategy=candidate,
                )

            result = execute_catalog(strategy, fast_period, slow_period)
            remaining_neighbors = 8 - len(neighbor_leg_results)
            if len(result.equity) >= 8 and remaining_neighbors > 0:
                def validate_neighbor(candidate: dict[str, Any]) -> None:
                    _catalog_strategy(leg.strategy_code, candidate)

                for candidate_parameters in parameter_neighbors(
                    leg.strategy_parameters,
                    validator=validate_neighbor,
                    limit=min(2, remaining_neighbors),
                ):
                    candidate_strategy, candidate_fast, candidate_slow = _catalog_strategy(
                        leg.strategy_code,
                        candidate_parameters,
                    )
                    neighbor_leg_results.append(
                        (
                            leg.id,
                            execute_catalog(candidate_strategy, candidate_fast, candidate_slow),
                            f"{leg.id}:{json.dumps(candidate_parameters, sort_keys=True, separators=(',', ':'))}",
                        )
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
        if checkpoint is not None:
            checkpoint(20 + ((leg_index + 1) * 50 // max(1, len(sorted_legs))))
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
        "historicalCoverage": parameters.get("historicalCoverage"),
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
    if len(portfolio.equity) >= 8:
        if checkpoint is not None:
            checkpoint(80)
        candidate_equity = {"base": portfolio.equity}
        base_oos_return = out_of_sample_return(portfolio.equity)
        neighbor_oos_returns = []
        for changed_leg_id, changed_result, candidate_name in neighbor_leg_results:
            candidate_portfolio = run_portfolio(
                [
                    replace(item, result=changed_result)
                    if item.id == changed_leg_id
                    else item
                    for item in portfolio_legs
                ],
                total_capital=total_capital,
                assumptions=assumptions,
                portfolio_hash=run.strategy_hash,
            )
            candidate_equity[candidate_name] = candidate_portfolio.equity
            neighbor_oos_returns.append(out_of_sample_return(candidate_portfolio.equity))
        diagnostics = build_walk_forward_selection(
            candidate_equity,
            folds=min(3, len(portfolio.equity) // 4),
        )
        stability = parameter_stability(
            base_oos_return=base_oos_return,
            neighbor_oos_returns=neighbor_oos_returns,
        )
        diagnostics["parameterStability"] = stability
        combined = combined_robustness_status(
            sample_adequacy=diagnostics["sampleAdequacy"],
            positive_fold_pct=diagnostics["outOfSamplePositiveFoldPct"],
            parameter_status=stability["status"],
        )
        diagnostics["overallStatus"] = combined["status"]
        diagnostics["warnings"] = sorted(set([
            *diagnostics["warnings"],
            *stability["warnings"],
            *combined["warnings"],
        ]))
        artifacts.append(_artifact("robustness", diagnostics))
    if checkpoint is not None:
        checkpoint(90)
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
        _checkpoint(repository, run, 10)
        datasets = repository.load_datasets(run)
        _checkpoint(repository, run, 15)
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
            summary, artifacts = _process_portfolio_run(
                run,
                execution_datasets,
                checkpoint=lambda progress: _checkpoint(repository, run, progress),
            )
        else:
            _checkpoint(repository, run, 30)
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
            _checkpoint(repository, run, 90)
        _checkpoint(repository, run, 95)
        if not repository.complete_run(run, summary, artifacts):
            return {"status": "lease_lost", "id": run.id, "code": "WORKER_LOST"}
        return {"status": "succeeded", "id": run.id, "metrics": summary}
    except RunControlStop as stopped:
        return {"status": stopped.status, "id": run.id}
    except ValueError:
        repository.fail_run(run, "DSL_INVALID", "Backtest configuration is invalid.")
        return {"status": "failed", "id": run.id, "code": "DSL_INVALID"}
    except Exception:
        repository.fail_run(run, "ENGINE_FAILED", "Backtest execution failed.")
        return {"status": "failed", "id": run.id, "code": "ENGINE_FAILED"}
