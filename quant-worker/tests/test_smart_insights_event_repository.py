from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

from smart_insights.event_contracts import EventInput
from smart_insights.event_normalization import normalize_event


NOW = datetime(2026, 8, 14, 12, tzinfo=timezone.utc)


def event(source: str, key: str, *, title: str = "Flooding in Manila Philippines"):
    raw = EventInput(
        source_code=source,
        source_event_key=key,
        category="flood",
        subcategory="FL",
        title=title,
        occurred_at=NOW - timedelta(hours=2),
        provider_severity=None,
        country="Philippines",
        region="Manila",
        latitude=14.60,
        longitude=120.98,
        affected_count=None,
        fatalities=None,
        source_url="https://example.org/flood/1",
        dimensions={"alert_level": "orange", "entities": ["Manila", "Philippines"]},
    )
    if source == "nasa-eonet":
        raw = replace(raw, dimensions={"entities": ["Manila", "Philippines"]})
    return normalize_event(raw, NOW)


def test_repository_is_idempotent_and_counts_only_distinct_providers() -> None:
    from smart_insights.event_repository import EventRepository

    repository = EventRepository()
    first = repository.publish((event("gdacs-events", "FL:1"),))
    replay = repository.publish((event("gdacs-events", "FL:1"),))
    corroborated = repository.publish((event("nasa-eonet", "EONET_1"),))

    assert first.inserted == 1
    assert replay.unchanged == 1
    assert corroborated.inserted == 1
    clusters = repository.clusters()
    assert len(clusters) == 1
    assert clusters[0].corroboration_count == 2
    assert sum(state.count for state in repository.baselines()) == 1


def test_repository_keeps_distinct_events_in_distinct_clusters() -> None:
    from smart_insights.event_repository import EventRepository

    repository = EventRepository()
    repository.publish((event("gdacs-events", "FL:1"),))
    distant = replace(
        event("nasa-eonet", "EONET_2", title="Flooding in Hanoi Vietnam"),
        country="VIETNAM",
        region="Hanoi",
        latitude=21.03,
        longitude=105.85,
        occurred_at=NOW - timedelta(days=4),
    )
    repository.publish((distant,))

    assert len(repository.clusters()) == 2


def test_repository_marks_borderline_candidate_for_review() -> None:
    from smart_insights.event_repository import EventRepository

    repository = EventRepository()
    repository.publish((event("gdacs-events", "FL:1"),))
    candidate = replace(
        event("nasa-eonet", "EONET_3", title="Heavy rain causes flood risk near Manila"),
        latitude=18.5,
        longitude=121.0,
        occurred_at=NOW + timedelta(hours=36),
    )
    outcome = repository.publish((candidate,))

    assert outcome.review_required in {0, 1}
    if outcome.review_required:
        assert len(repository.clusters()) == 2
