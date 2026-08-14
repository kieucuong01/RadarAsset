from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
import math


METHODOLOGY_VERSION = "macro-event-risk-v1"
MINIMUM_FRESH_WEIGHT = 0.60
EVENT_RISK_V1 = {
    "severity": 0.30,
    "frequency_anomaly": 0.25,
    "corroboration": 0.20,
    "strategic_relevance": 0.15,
    "market_stress": 0.10,
}


def _aware(value: datetime) -> bool:
    return value.tzinfo is not None and value.utcoffset() is not None


@dataclass(frozen=True, slots=True)
class EventRiskComponent:
    name: str
    value: float | None
    as_of: datetime
    fresh: bool
    source_evidence: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.name not in EVENT_RISK_V1:
            raise ValueError(f"Unknown event-risk component: {self.name}")
        if not _aware(self.as_of):
            raise ValueError("Component as_of must be timezone-aware.")
        if self.value is not None and (
            not math.isfinite(self.value) or not 0 <= self.value <= 100
        ):
            raise ValueError("Component value must be between zero and 100.")
        if any(not item for item in self.source_evidence):
            raise ValueError("Source evidence identifiers must be non-empty.")


@dataclass(frozen=True, slots=True)
class EventRiskInputs:
    as_of: datetime
    components: Mapping[str, EventRiskComponent]


@dataclass(frozen=True, slots=True)
class EventRiskResult:
    value: float | None
    status: str
    coverage: float
    methodology: str
    reason: str | None
    as_of: datetime
    evidence: tuple[str, ...]


def calculate_event_risk(inputs: EventRiskInputs) -> EventRiskResult:
    if not _aware(inputs.as_of):
        raise ValueError("Event risk as_of must be timezone-aware.")
    for name, component in inputs.components.items():
        if name != component.name:
            raise ValueError("Component map key must match component name.")
    usable = {
        name: component
        for name, component in inputs.components.items()
        if component.fresh and component.value is not None
    }
    coverage = round(sum(EVENT_RISK_V1[name] for name in usable), 10)
    evidence = tuple(
        dict.fromkeys(
            evidence_id
            for name in EVENT_RISK_V1
            if name in usable
            for evidence_id in usable[name].source_evidence
        )
    )
    if coverage < MINIMUM_FRESH_WEIGHT:
        return EventRiskResult(
            value=None,
            status="UNAVAILABLE",
            coverage=coverage,
            methodology=METHODOLOGY_VERSION,
            reason="INSUFFICIENT_FRESH_WEIGHT",
            as_of=inputs.as_of,
            evidence=evidence,
        )
    value = sum(EVENT_RISK_V1[name] * float(component.value) for name, component in usable.items())
    return EventRiskResult(
        value=round(value, 4),
        status="AVAILABLE" if coverage == 1.0 else "LIMITED_DATA",
        coverage=coverage,
        methodology=METHODOLOGY_VERSION,
        reason=None,
        as_of=inputs.as_of,
        evidence=evidence,
    )
