from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

import pytest

from smart_insights.event_contracts import EventInput
from smart_insights.event_normalization import normalize_event


UTC_NOW = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)


def usgs_event() -> EventInput:
    return EventInput(
        source_code="usgs-earthquakes",
        source_event_key="us7000abcd",
        category="earthquake",
        subcategory=None,
        title="  M 6.2   Northern Ridge  ",
        occurred_at=datetime(2026, 8, 14, 10, 30, tzinfo=timezone.utc),
        provider_severity=6.2,
        country="id",
        region="Northern Ridge",
        latitude=-3.12,
        longitude=128.44,
        affected_count=None,
        fatalities=None,
        source_url="https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
        dimensions={"magnitude_type": "mww"},
    )


def test_normalizes_usgs_event_into_a_stable_quant_contract() -> None:
    event = normalize_event(usgs_event(), observed_at=UTC_NOW)

    assert event.category == "natural_hazard"
    assert event.title == "M 6.2 Northern Ridge"
    assert event.country == "ID"
    assert event.normalized_severity == 62.0
    assert event.occurred_at.tzinfo is timezone.utc
    assert len(event.content_hash) == 64


@pytest.mark.parametrize(
    ("raw", "observed_at", "field"),
    [
        (replace(usgs_event(), occurred_at=datetime(2026, 8, 14, 10, 30)), UTC_NOW, "occurred_at"),
        (usgs_event(), datetime(2026, 8, 14, 12, 0), "observed_at"),
    ],
)
def test_rejects_naive_event_timestamps(
    raw: EventInput, observed_at: datetime, field: str
) -> None:
    with pytest.raises(ValueError, match=rf"{field} must be timezone-aware"):
        normalize_event(raw, observed_at=observed_at)


@pytest.mark.parametrize(
    ("raw", "severity", "required_flag", "parser_version"),
    [
        (
            replace(
                usgs_event(),
                source_code="gdelt-events",
                provider_severity=72.0,
                category="geopolitical",
            ),
            72.0,
            None,
            "gdelt-events-v1",
        ),
        (
            replace(
                usgs_event(),
                source_code="gdacs-events",
                provider_severity=None,
                dimensions={"alert_level": "orange"},
            ),
            60.0,
            None,
            "gdacs-events-v1",
        ),
        (
            replace(usgs_event(), provider_severity=11.0),
            100.0,
            "severity_clamped",
            "usgs-earthquakes-v1",
        ),
        (
            replace(
                usgs_event(),
                source_code="nasa-eonet",
                provider_severity=None,
                category="wildfire",
                dimensions={"category": "wildfires"},
            ),
            None,
            "severity_unavailable",
            "nasa-eonet-v1",
        ),
    ],
)
def test_applies_source_specific_severity_without_inventing_missing_values(
    raw: EventInput,
    severity: float | None,
    required_flag: str | None,
    parser_version: str,
) -> None:
    event = normalize_event(raw, observed_at=UTC_NOW)

    assert event.normalized_severity == severity
    assert event.parser_version == parser_version
    if required_flag is not None:
        assert required_flag in event.quality_flags


def test_content_hash_tracks_event_facts_not_collection_time() -> None:
    first = normalize_event(usgs_event(), observed_at=UTC_NOW)
    replay = normalize_event(
        usgs_event(), observed_at=datetime(2026, 8, 14, 13, 0, tzinfo=timezone.utc)
    )
    changed = normalize_event(
        replace(usgs_event(), title="M 6.3 Northern Ridge"), observed_at=UTC_NOW
    )

    assert replay.content_hash == first.content_hash
    assert changed.content_hash != first.content_hash


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (replace(usgs_event(), source_event_key="  "), "source_event_key is required"),
        (replace(usgs_event(), title="\t"), "title is required"),
        (replace(usgs_event(), latitude=91.0), "coordinates are invalid"),
        (replace(usgs_event(), longitude=None), "coordinates must be supplied together"),
        (replace(usgs_event(), fatalities=-1), "fatalities must be non-negative"),
        (
            replace(usgs_event(), source_url="http://earthquake.usgs.gov/event/us7000abcd"),
            "source_url must use https",
        ),
        (replace(usgs_event(), provider_severity=float("nan")), "provider_severity must be finite"),
        (replace(usgs_event(), dimensions={"bad": {"not-json"}}), "dimensions must be JSON"),
    ],
)
def test_rejects_invalid_or_unsafe_provider_fields(raw: EventInput, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        normalize_event(raw, observed_at=UTC_NOW)


def test_unknown_category_is_preserved_as_an_explicit_quality_warning() -> None:
    event = normalize_event(
        replace(usgs_event(), category="provider-specific-unknown"), observed_at=UTC_NOW
    )

    assert event.category == "other"
    assert "unmapped_category" in event.quality_flags
