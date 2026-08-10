from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class Bar:
    asset: str
    timestamp: datetime
    timeframe: str
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal | None
    source: str


@dataclass(frozen=True)
class QualityIssue:
    code: str
    severity: str
    timestamp: datetime | None = None
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class QualityReport:
    status: str
    missing_bar_count: int
    issues: tuple[QualityIssue, ...]
