from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
import hashlib

from .event_contracts import EventObservation
from .event_deduplication import (
    BaselineState,
    classify_match,
    event_match_score,
    update_baseline,
)


@dataclass(frozen=True, slots=True)
class EventCluster:
    cluster_key: str
    category: str
    title: str
    country: str | None
    region: str | None
    latitude: float | None
    longitude: float | None
    occurred_at: datetime
    normalized_severity: float | None
    corroboration_count: int
    status: str
    quality_flags: tuple[str, ...]
    observation_keys: tuple[tuple[str, str], ...]


@dataclass(frozen=True, slots=True)
class EventPublicationResult:
    inserted: int
    unchanged: int
    clusters_created: int
    review_required: int


def _cluster_key(event: EventObservation) -> str:
    raw = "|".join(
        (
            event.category,
            event.country or "GLOBAL",
            event.occurred_at.strftime("%Y-%m-%dT%H"),
            event.source_code,
            event.source_event_key,
        )
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _baseline_key(cluster: EventCluster) -> str:
    return ":".join(
        (
            cluster.category,
            cluster.country or "GLOBAL",
            str(cluster.occurred_at.weekday()),
            str(cluster.occurred_at.month),
        )
    )


def _new_cluster(event: EventObservation, *, status: str = "active") -> EventCluster:
    return EventCluster(
        cluster_key=_cluster_key(event),
        category=event.category,
        title=event.title,
        country=event.country,
        region=event.region,
        latitude=event.latitude,
        longitude=event.longitude,
        occurred_at=event.occurred_at,
        normalized_severity=event.normalized_severity,
        corroboration_count=1,
        status=status,
        quality_flags=("dedup_review_required",) if status == "review" else (),
        observation_keys=((event.source_code, event.source_event_key),),
    )


class EventRepository:
    """Atomic in-memory event store used by the deterministic pipeline and tests.

    The PostgreSQL publisher mirrors these state transitions inside one database
    transaction; this class keeps calculation behavior free from database I/O.
    """

    def __init__(self) -> None:
        self._observations: dict[tuple[str, str], EventObservation] = {}
        self._clusters: dict[str, EventCluster] = {}
        self._baselines: dict[str, BaselineState] = {}

    def publish(self, events: tuple[EventObservation, ...]) -> EventPublicationResult:
        observations = dict(self._observations)
        clusters = dict(self._clusters)
        baselines = dict(self._baselines)
        inserted = unchanged = created = review_required = 0
        for event in events:
            observation_key = (event.source_code, event.source_event_key)
            existing = observations.get(observation_key)
            if existing is not None and existing.content_hash == event.content_hash:
                unchanged += 1
                continue
            if existing is not None:
                observations[observation_key] = event
                unchanged += 1
                continue

            candidates: list[tuple[float, EventCluster, EventObservation]] = []
            for cluster in clusters.values():
                representative_key = cluster.observation_keys[0]
                representative = observations[representative_key]
                candidates.append((event_match_score(representative, event), cluster, representative))
            candidates.sort(key=lambda item: item[0], reverse=True)
            best_score = candidates[0][0] if candidates else 0.0
            decision = classify_match(best_score)
            if candidates and decision == "match":
                cluster = candidates[0][1]
                keys = cluster.observation_keys + (observation_key,)
                provider_count = len({source for source, _key in keys})
                severities = [
                    value
                    for value in (cluster.normalized_severity, event.normalized_severity)
                    if value is not None
                ]
                clusters[cluster.cluster_key] = replace(
                    cluster,
                    corroboration_count=provider_count,
                    normalized_severity=max(severities) if severities else None,
                    observation_keys=keys,
                )
            else:
                status = "review" if decision == "review" else "active"
                cluster = _new_cluster(event, status=status)
                clusters[cluster.cluster_key] = cluster
                baseline_key = _baseline_key(cluster)
                baselines[baseline_key] = update_baseline(
                    baselines.get(baseline_key, BaselineState.empty(baseline_key)),
                    1.0,
                )
                created += 1
                review_required += int(status == "review")
            observations[observation_key] = event
            inserted += 1

        self._observations = observations
        self._clusters = clusters
        self._baselines = baselines
        return EventPublicationResult(inserted, unchanged, created, review_required)

    def clusters(self) -> tuple[EventCluster, ...]:
        return tuple(sorted(self._clusters.values(), key=lambda item: item.occurred_at, reverse=True))

    def baselines(self) -> tuple[BaselineState, ...]:
        return tuple(sorted(self._baselines.values(), key=lambda item: item.baseline_key))

    def observations(self) -> tuple[EventObservation, ...]:
        return tuple(self._observations.values())
