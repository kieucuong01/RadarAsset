from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from .models import Bar
from .strategy_factory import strategy_from_catalog


@dataclass(frozen=True)
class ActiveAssignment:
    assignment_id: str
    organization_id: str
    asset_id: str
    strategy_version_id: str
    strategy_code: str
    strategy_version: str
    parameters: dict[str, Any]
    position_quantity: Decimal


def evaluate_latest_signal(
    assignment: ActiveAssignment,
    bars: list[Bar],
    *,
    dataset_version_id: str,
) -> dict[str, Any] | None:
    if not bars:
        return None
    strategy = strategy_from_catalog(
        assignment.strategy_code,
        assignment.strategy_version,
        assignment.parameters,
    )
    index = len(bars) - 1
    signal = strategy.signal(bars, index, in_position=assignment.position_quantity > 0)
    if signal is None:
        return None
    return {
        "organizationId": assignment.organization_id,
        "assignmentId": assignment.assignment_id,
        "assetId": assignment.asset_id,
        "strategyVersionId": assignment.strategy_version_id,
        "signalType": signal.action,
        "signalAt": signal.signal_at,
        "signalPrice": bars[index].close,
        "reason": signal.reason,
        "metadata": {
            **signal.metadata,
            "datasetVersionId": dataset_version_id,
            "source": "live_dataset_close",
        },
    }
