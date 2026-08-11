from datetime import datetime
from decimal import Decimal
from typing import Any

from backtest.models import Bar
from backtest.quality import canonical_bar_checksum
from worker import DatasetInput, QueuedRun, bars_in_run_range, process_next_run


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
    def __init__(self, run: QueuedRun | None, dataset: DatasetInput | None = None) -> None:
        self.run = run
        self.dataset = dataset
        self.completed: tuple[str, dict[str, Any], list[dict[str, Any]]] | None = None
        self.failed: tuple[str, str, str] | None = None

    def claim_next_run(self) -> QueuedRun | None:
        claimed, self.run = self.run, None
        return claimed

    def load_datasets(self, _run: QueuedRun) -> list[DatasetInput]:
        assert self.dataset is not None
        return [self.dataset]

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
