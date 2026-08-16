from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Protocol

from backtest.models import Bar


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
    deadline_at: datetime | None = None
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
    ) -> bool: ...

    def fail_run(self, run: QueuedRun, code: str, message: str) -> bool: ...

    def checkpoint_run(self, run: QueuedRun, progress: int) -> str: ...
