from __future__ import annotations

from dataclasses import dataclass

from smart_insights.contracts import ObservationInput, RawSnapshot


@dataclass(frozen=True, slots=True)
class ContextCollectionBatch:
    source_code: str
    snapshot: RawSnapshot | None
    observations: tuple[ObservationInput, ...]
    status: str
    error_code: str | None = None
