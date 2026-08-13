from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from smart_insights.contracts import ObservationInput, RawSnapshot, SourceDefinition


@dataclass(frozen=True, slots=True)
class CollectionBatch:
    source: SourceDefinition
    snapshot: RawSnapshot
    observations: tuple[ObservationInput, ...]
    error_code: str | None = None
    rejected_periods: tuple[datetime, ...] = ()
