from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
import math

from .event_contracts import EventObservation


MATCH_THRESHOLD_V1 = 0.82
BORDERLINE_THRESHOLD_V1 = 0.68


@dataclass(frozen=True, slots=True)
class BaselineState:
    baseline_key: str
    count: int
    mean: float
    m2: float

    @classmethod
    def empty(cls, baseline_key: str) -> BaselineState:
        return cls(baseline_key=baseline_key, count=0, mean=0.0, m2=0.0)

    @property
    def variance(self) -> float | None:
        if self.count < 2:
            return None
        return self.m2 / (self.count - 1)


def update_baseline(state: BaselineState, value: float) -> BaselineState:
    if not math.isfinite(value):
        raise ValueError("Baseline value must be finite.")
    count = state.count + 1
    delta = value - state.mean
    mean = state.mean + delta / count
    m2 = state.m2 + delta * (value - mean)
    return BaselineState(state.baseline_key, count, mean, m2)


def _haversine_km(left: EventObservation, right: EventObservation) -> float | None:
    if None in (left.latitude, left.longitude, right.latitude, right.longitude):
        return None
    assert left.latitude is not None and left.longitude is not None
    assert right.latitude is not None and right.longitude is not None
    lat1, lon1, lat2, lon2 = map(
        math.radians,
        (left.latitude, left.longitude, right.latitude, right.longitude),
    )
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def geographic_similarity(left: EventObservation, right: EventObservation) -> float:
    if left.country and right.country and left.country != right.country:
        return 0.0
    distance = _haversine_km(left, right)
    if distance is not None:
        return max(0.0, 1.0 - distance / 500.0)
    if left.country and right.country and left.country == right.country:
        return 0.8
    if left.region and right.region and left.region.casefold() == right.region.casefold():
        return 0.7
    return 0.25


def temporal_similarity(left: EventObservation, right: EventObservation) -> float:
    hours = abs((left.occurred_at - right.occurred_at).total_seconds()) / 3_600
    return max(0.0, 1.0 - hours / 72.0)


def title_similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, left.casefold(), right.casefold(), autojunk=False).ratio()


def _entities(event: EventObservation) -> set[str]:
    raw = event.dimensions.get("entities")
    if not isinstance(raw, list):
        return set()
    return {str(value).casefold().strip() for value in raw if str(value).strip()}


def entity_similarity(left: EventObservation, right: EventObservation) -> float:
    left_entities, right_entities = _entities(left), _entities(right)
    if not left_entities or not right_entities:
        return 0.0
    return len(left_entities & right_entities) / len(left_entities | right_entities)


def event_match_score(left: EventObservation, right: EventObservation) -> float:
    if left.category != right.category:
        return 0.0
    return round(
        0.35 * geographic_similarity(left, right)
        + 0.30 * temporal_similarity(left, right)
        + 0.25 * title_similarity(left.title, right.title)
        + 0.10 * entity_similarity(left, right),
        6,
    )


def classify_match(score: float) -> str:
    if not 0 <= score <= 1 or not math.isfinite(score):
        raise ValueError("Match score must be between zero and one.")
    if score >= MATCH_THRESHOLD_V1:
        return "match"
    if score >= BORDERLINE_THRESHOLD_V1:
        return "review"
    return "distinct"
