from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from smart_insights.metrics.event_risk import (
    EVENT_RISK_V1,
    EventRiskComponent,
    EventRiskInputs,
    calculate_event_risk,
)


NOW = datetime(2026, 8, 14, 12, tzinfo=timezone.utc)


def inputs(*, stale: set[str] | None = None) -> EventRiskInputs:
    values = {
        "severity": 80.0,
        "frequency_anomaly": 70.0,
        "corroboration": 75.0,
        "strategic_relevance": 60.0,
        "market_stress": 60.0,
    }
    stale = stale or set()
    return EventRiskInputs(
        as_of=NOW,
        components={
            name: EventRiskComponent(
                name=name,
                value=value,
                as_of=NOW - (timedelta(days=2) if name in stale else timedelta(minutes=5)),
                fresh=name not in stale,
                source_evidence=(f"evidence:{name}",),
            )
            for name, value in values.items()
        },
    )


def test_event_risk_is_deterministic_and_carries_methodology_evidence() -> None:
    result = calculate_event_risk(inputs())

    assert result.status == "AVAILABLE"
    assert result.value == pytest.approx(71.5)
    assert result.coverage == pytest.approx(1.0)
    assert result.methodology == "macro-event-risk-v1"
    assert len(result.evidence) == len(EVENT_RISK_V1)


def test_event_risk_withholds_value_below_sixty_percent_fresh_weight() -> None:
    result = calculate_event_risk(
        inputs(stale={"corroboration", "strategic_relevance", "market_stress"})
    )

    assert result.status == "UNAVAILABLE"
    assert result.value is None
    assert result.coverage == pytest.approx(0.55)
    assert result.reason == "INSUFFICIENT_FRESH_WEIGHT"


def test_missing_component_is_not_renormalized_or_imputed() -> None:
    raw = inputs()
    components = dict(raw.components)
    components.pop("market_stress")
    result = calculate_event_risk(EventRiskInputs(as_of=NOW, components=components))

    assert result.status == "LIMITED_DATA"
    assert result.coverage == pytest.approx(0.9)
    assert result.value == pytest.approx(65.5)


def test_component_values_must_be_bounded_and_as_of_must_be_aware() -> None:
    with pytest.raises(ValueError, match="between zero and 100"):
        EventRiskComponent("severity", 101.0, NOW, True, ())
    with pytest.raises(ValueError, match="timezone-aware"):
        calculate_event_risk(EventRiskInputs(NOW.replace(tzinfo=None), {}))
