from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

from smart_insights.event_contracts import EventInput
from smart_insights.event_normalization import normalize_event


NOW = datetime(2026, 8, 14, 12, tzinfo=timezone.utc)


def event(**overrides: object):
    raw = EventInput(
        source_code="gdacs-events",
        source_event_key="EQ:1",
        category="earthquake",
        subcategory="EQ",
        title="Magnitude 6.2 earthquake near Sendai Japan",
        occurred_at=NOW - timedelta(hours=1),
        provider_severity=None,
        country="Japan",
        region="Sendai",
        latitude=38.4,
        longitude=141.25,
        affected_count=None,
        fatalities=None,
        source_url="https://www.gdacs.org/report.aspx?id=1",
        dimensions={"alert_level": "orange", "entities": ["Sendai", "Japan"]},
    )
    return normalize_event(replace(raw, **overrides), NOW)


def test_same_event_across_sources_matches_above_versioned_threshold() -> None:
    from smart_insights.event_deduplication import MATCH_THRESHOLD_V1, event_match_score

    left = event()
    right = event(
        source_code="usgs-earthquakes",
        source_event_key="us7000abc",
        title="M 6.2 - 55 km east of Sendai, Japan",
        provider_severity=6.2,
        latitude=38.42,
        longitude=141.30,
        source_url="https://earthquake.usgs.gov/earthquakes/eventpage/us7000abc",
        dimensions={"entities": ["Sendai", "Japan"], "depth_km": 35.0},
    )

    assert event_match_score(left, right) >= MATCH_THRESHOLD_V1


def test_nearby_but_distinct_events_and_country_mismatch_do_not_merge() -> None:
    from smart_insights.event_deduplication import MATCH_THRESHOLD_V1, event_match_score

    left = event()
    later = event(source_event_key="EQ:2", occurred_at=NOW + timedelta(days=4))
    wrong_country = event(
        source_event_key="EQ:3",
        country="Chile",
        region="Sendai",
        latitude=None,
        longitude=None,
    )

    assert event_match_score(left, later) < MATCH_THRESHOLD_V1
    assert event_match_score(left, wrong_country) < MATCH_THRESHOLD_V1


def test_borderline_match_is_flagged_for_review_not_silently_merged() -> None:
    from smart_insights.event_deduplication import BORDERLINE_THRESHOLD_V1, MATCH_THRESHOLD_V1, classify_match

    result = classify_match((BORDERLINE_THRESHOLD_V1 + MATCH_THRESHOLD_V1) / 2)
    assert result == "review"


def test_welford_baseline_is_stable_and_exposes_variance() -> None:
    from smart_insights.event_deduplication import BaselineState, update_baseline

    state = BaselineState.empty("natural_hazard:GLOBAL:4:8")
    for value in (10.0, 20.0, 30.0):
        state = update_baseline(state, value)

    assert state.count == 3
    assert state.mean == 20.0
    assert state.variance == 100.0
