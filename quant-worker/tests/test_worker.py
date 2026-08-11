from datetime import datetime
from decimal import Decimal
from typing import Any

import pytest

from backtest.models import Bar
from backtest.quality import canonical_bar_checksum
from worker import (
    DatasetInput,
    PostgresWorkerRepository,
    QueuedRun,
    QueuedRunLeg,
    bars_in_run_range,
    process_next_run,
)


def golden_bars() -> list[Bar]:
    closes = ["10", "9", "8", "10", "12", "13", "8", "7"]
    opens = ["10", "9", "8", "10", "11", "13", "12", "7"]
    dates = ["01", "02", "03", "04", "05", "08", "09", "10"]
    return [
        Bar(
            asset="BTC",
            timestamp=datetime.fromisoformat(f"2024-01-{day}T00:00:00+00:00"),
            timeframe="1d",
            open=Decimal(open_price),
            high=max(Decimal(open_price), Decimal(close)) + Decimal("1"),
            low=min(Decimal(open_price), Decimal(close)) - Decimal("1"),
            close=Decimal(close),
            volume=Decimal("100"),
            source="worker-fixture",
        )
        for day, open_price, close in zip(dates, opens, closes, strict=True)
    ]


def queued_run() -> QueuedRun:
    return QueuedRun(
        id="run-1",
        organization_id="org-1",
        strategy_hash="worker-strategy",
        parameters={
            "strategy": "ma_cross",
            "timeframe": "1d",
            "fastPeriod": 2,
            "slowPeriod": 3,
            "initialCapital": 1000,
            "feeBps": 10,
            "slippageBps": 5,
            "from": "2024-01-01",
            "to": "2024-01-31",
            "legs": [{"symbol": "BTC", "leverage": 1}],
        },
        dataset_version_ids=("dataset-version-1",),
    )


class FakeRepository:
    def __init__(
        self,
        run: QueuedRun | None,
        dataset: DatasetInput | list[DatasetInput] | None = None,
    ) -> None:
        self.run = run
        self.dataset = dataset
        self.completed: tuple[str, dict[str, Any], list[dict[str, Any]]] | None = None
        self.failed: tuple[str, str, str] | None = None

    def claim_next_run(self) -> QueuedRun | None:
        claimed, self.run = self.run, None
        return claimed

    def load_datasets(self, _run: QueuedRun) -> list[DatasetInput]:
        assert self.dataset is not None
        return self.dataset if isinstance(self.dataset, list) else [self.dataset]

    def complete_run(
        self,
        run: QueuedRun,
        summary: dict[str, Any],
        artifacts: list[dict[str, Any]],
    ) -> None:
        self.completed = (run.id, summary, artifacts)

    def fail_run(self, run: QueuedRun, code: str, message: str) -> None:
        self.failed = (run.id, code, message)


def test_process_next_run_commits_real_checksummed_artifacts() -> None:
    bars = golden_bars()
    repository = FakeRepository(
        queued_run(),
        DatasetInput(
            version_id="dataset-version-1",
            asset="BTC",
            market="crypto_spot",
            checksum=canonical_bar_checksum(bars),
            bars=bars,
        ),
    )

    response = process_next_run(repository)

    assert response["status"] == "succeeded"
    assert repository.failed is None
    assert repository.completed is not None
    run_id, summary, artifacts = repository.completed
    assert run_id == "run-1"
    assert summary["tradeCount"] == 1
    assert [artifact["kind"] for artifact in artifacts] == [
        "equity",
        "drawdown",
        "trades",
        "manifest",
    ]
    assert all(len(artifact["checksum"]) == 64 for artifact in artifacts)
    trades = next(artifact["payload"] for artifact in artifacts if artifact["kind"] == "trades")
    assert all(trade["side"] == "long" for trade in trades)


def test_process_next_run_fails_closed_on_dataset_checksum_mismatch() -> None:
    repository = FakeRepository(
        queued_run(),
        DatasetInput(
            version_id="dataset-version-1",
            asset="BTC",
            market="crypto_spot",
            checksum="0" * 64,
            bars=golden_bars(),
        ),
    )

    response = process_next_run(repository)

    assert response == {"status": "failed", "id": "run-1", "code": "DATASET_CHECKSUM_MISMATCH"}
    assert repository.completed is None
    assert repository.failed == (
        "run-1",
        "DATASET_CHECKSUM_MISMATCH",
        "Dataset checksum verification failed.",
    )


def test_process_next_run_is_idle_when_no_queued_backtest_exists() -> None:
    repository = FakeRepository(None)

    assert process_next_run(repository) == {"status": "idle", "message": "No queued backtest runs."}


def test_process_next_run_accepts_versioned_catalog_ma_parameters() -> None:
    run = queued_run()
    run = QueuedRun(
        **{
            **run.__dict__,
            "parameters": {
                "strategyCode": "ma_crossover",
                "strategyVersion": "1.0.0",
                "strategyParameters": {"fastPeriod": 2, "slowPeriod": 3},
                "timeframe": "1d",
                "initialCapital": 1000,
                "feeBps": 10,
                "slippageBps": 5,
                "from": "2024-01-01",
                "to": "2024-01-31",
                "legs": [{"symbol": "BTC", "leverage": 1}],
            },
        }
    )
    repository = FakeRepository(
        run,
        DatasetInput(
            version_id="dataset-version-1",
            asset="BTC",
            market="crypto_spot",
            checksum=canonical_bar_checksum(golden_bars()),
            bars=golden_bars(),
        ),
    )

    response = process_next_run(repository)

    assert response["status"] == "succeeded"
    assert repository.failed is None


def test_process_next_run_dispatches_turtle_strategy_from_catalog_parameters() -> None:
    run = queued_run()
    run = QueuedRun(
        **{
            **run.__dict__,
            "parameters": {
                "strategyCode": "turtle_breakout",
                "strategyVersion": "1.0.0",
                "strategyParameters": {"entryPeriod": 2, "exitPeriod": 2},
                "timeframe": "1d",
                "initialCapital": 1000,
                "feeBps": 10,
                "slippageBps": 5,
                "from": "2024-01-01",
                "to": "2024-01-31",
                "legs": [{"symbol": "BTC", "leverage": 1}],
            },
        }
    )
    bars = golden_bars()
    repository = FakeRepository(
        run,
        DatasetInput(
            version_id="dataset-version-1",
            asset="BTC",
            market="crypto_spot",
            checksum=canonical_bar_checksum(bars),
            bars=bars,
        ),
    )

    response = process_next_run(repository)

    assert response["status"] == "succeeded"
    assert repository.failed is None
    assert repository.completed is not None
    manifest = next(artifact for artifact in repository.completed[2] if artifact["kind"] == "manifest")
    assert manifest["payload"]["strategyCode"] == "turtle_breakout"


@pytest.mark.parametrize(
    ("strategy_code", "strategy_parameters"),
    [
        ("signal_rolling_reversal", {"confirmationBars": 2}),
        (
            "abcd_causal",
            {
                "pivotLeftBars": 1,
                "pivotRightBars": 1,
                "retracementMin": 0.382,
                "retracementMax": 0.886,
                "extensionMin": 1.13,
                "extensionMax": 1.618,
            },
        ),
    ],
)
def test_process_next_run_dispatches_remaining_catalog_strategies(
    strategy_code: str, strategy_parameters: dict[str, Any]
) -> None:
    run = queued_run()
    run = QueuedRun(
        **{
            **run.__dict__,
            "parameters": {
                "strategyCode": strategy_code,
                "strategyVersion": "1.0.0",
                "strategyParameters": strategy_parameters,
                "timeframe": "1d",
                "initialCapital": 1000,
                "feeBps": 10,
                "slippageBps": 5,
                "from": "2024-01-01",
                "to": "2024-01-31",
                "legs": [{"symbol": "BTC", "leverage": 1}],
            },
        }
    )
    bars = golden_bars()
    repository = FakeRepository(
        run,
        DatasetInput(
            version_id="dataset-version-1",
            asset="BTC",
            market="crypto_spot",
            checksum=canonical_bar_checksum(bars),
            bars=bars,
        ),
    )

    response = process_next_run(repository)

    assert response["status"] == "succeeded"
    assert repository.failed is None


def test_worker_filters_dataset_rows_to_the_inclusive_requested_date_range() -> None:
    run = queued_run()
    run = QueuedRun(
        **{
            **run.__dict__,
            "parameters": {**run.parameters, "from": "2024-01-03", "to": "2024-01-09"},
        }
    )

    filtered = bars_in_run_range(golden_bars(), run)

    assert [row.timestamp.date().isoformat() for row in filtered] == [
        "2024-01-03",
        "2024-01-04",
        "2024-01-05",
        "2024-01-08",
        "2024-01-09",
    ]


def test_postgres_worker_lease_configuration_is_explicit_and_positive() -> None:
    repository = PostgresWorkerRepository(object(), worker_id="worker-a", lease_seconds=60)
    assert repository.worker_id == "worker-a"
    assert repository.lease_seconds == 60

    with pytest.raises(ValueError, match="lease"):
        PostgresWorkerRepository(object(), worker_id="worker-a", lease_seconds=0)


def test_process_next_run_executes_portfolio_legs_and_emits_scoped_artifacts() -> None:
    btc_bars = golden_bars()
    xau_bars = [
        Bar(
            asset="XAU",
            timestamp=bar.timestamp,
            timeframe=bar.timeframe,
            open=bar.open,
            high=bar.high,
            low=bar.low,
            close=bar.close,
            volume=bar.volume,
            source=bar.source,
        )
        for bar in btc_bars
    ]
    market_cost = {
        "commissionBps": 10,
        "sellTaxBps": 0,
        "slippageBps": 5,
        "financingBpsAnnual": 0,
    }
    run = QueuedRun(
        id="portfolio-run",
        organization_id="org-1",
        strategy_hash="portfolio-hash",
        parameters={
            "timeframe": "1d",
            "from": "2024-01-01",
            "to": "2024-01-31",
            "totalCapital": 1000,
            "allocationMode": "custom",
            "feeBps": 10,
            "slippageBps": 5,
            "assumptions": {
                "cashAllocationBps": 1000,
                "rebalanceFrequency": "monthly",
                "monthlyContribution": 100,
                "dividendMode": "exclude",
                "fxPolicy": "normalized_returns",
                "baseCurrency": "USD",
                "marketCosts": {
                    "vn_equity": market_cost,
                    "crypto_spot": market_cost,
                    "metal_spot": market_cost,
                },
            },
            "legs": [
                {
                    "symbol": "BTC",
                    "allocationBps": 6000,
                    "leverage": 1,
                    "strategyCode": "ma_crossover",
                    "strategyVersion": "1.0.0",
                    "strategyParameters": {"fastPeriod": 2, "slowPeriod": 3},
                },
                {
                    "symbol": "XAU",
                    "allocationBps": 3000,
                    "leverage": 1,
                    "strategyCode": "turtle_breakout",
                    "strategyVersion": "1.0.0",
                    "strategyParameters": {"entryPeriod": 2, "exitPeriod": 2},
                },
            ],
        },
        dataset_version_ids=("dataset-btc", "dataset-xau"),
        legs=(
            QueuedRunLeg(
                id="leg-btc",
                asset="BTC",
                market="crypto_spot",
                dataset_version_id="dataset-btc",
                allocation_bps=6000,
                initial_notional=Decimal("600"),
                leverage=Decimal("1"),
                strategy_code="ma_crossover",
                strategy_version="1.0.0",
                strategy_parameters={"fastPeriod": 2, "slowPeriod": 3},
            ),
            QueuedRunLeg(
                id="leg-xau",
                asset="XAU",
                market="metal_spot",
                dataset_version_id="dataset-xau",
                allocation_bps=3000,
                initial_notional=Decimal("300"),
                leverage=Decimal("1"),
                strategy_code="turtle_breakout",
                strategy_version="1.0.0",
                strategy_parameters={"entryPeriod": 2, "exitPeriod": 2},
            ),
        ),
    )
    repository = FakeRepository(
        run,
        [
            DatasetInput(
                "dataset-btc",
                "BTC",
                "crypto_spot",
                canonical_bar_checksum(btc_bars),
                btc_bars,
                "raw",
            ),
            DatasetInput(
                "dataset-xau",
                "XAU",
                "metal_spot",
                canonical_bar_checksum(xau_bars),
                xau_bars,
                "raw",
            ),
        ],
    )

    response = process_next_run(repository)

    assert response["status"] == "succeeded"
    assert repository.completed is not None
    artifacts = repository.completed[2]
    assert {artifact["scopeKey"] for artifact in artifacts} == {
        "aggregate",
        "leg:leg-btc",
        "leg:leg-xau",
    }
    assert {artifact["kind"] for artifact in artifacts if artifact["scopeKey"] == "aggregate"} == {
        "equity",
        "drawdown",
        "contribution",
        "cash_flow",
        "rebalance",
        "manifest",
    }
    leg_manifests = [
        artifact
        for artifact in artifacts
        if artifact["kind"] == "manifest" and artifact["quantRunLegId"] is not None
    ]
    assert {item["payload"]["strategyCode"] for item in leg_manifests} == {
        "ma_crossover",
        "turtle_breakout",
    }
