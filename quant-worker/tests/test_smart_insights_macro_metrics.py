from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from smart_insights.macro_registry import classify_surprise_event
from smart_insights.metrics.macro import (
    COMPONENT_WEIGHTS,
    MACRO_GROUP_WEIGHTS,
    METRIC_DEFINITIONS_BY_CODE,
    event_risk_score,
    market_event_risk,
    parse_release_number,
    release_surprise,
    surprise_z_score,
)


NOW = datetime(2026, 8, 13, 13, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("0.2%", Decimal("0.2")),
        ("-12.5K", Decimal("-12500")),
        ("1.2M", Decimal("1200000")),
        ("3B", Decimal("3000000000")),
        ("0.5T", Decimal("500000000000")),
        (" 52.1 ", Decimal("52.1")),
    ],
)
def test_release_number_parses_source_units(raw: str, expected: Decimal) -> None:
    assert parse_release_number(raw) == expected


def test_release_number_rejects_decimal_comma_unless_declared() -> None:
    with pytest.raises(ValueError, match="DECIMAL_COMMA"):
        parse_release_number("1,2%")
    assert parse_release_number("1,2%", decimal_comma=True) == Decimal("1.2")


def test_surprise_and_same_series_minimum_history() -> None:
    assert release_surprise(Decimal("0.2"), Decimal("0.3")) == Decimal("-0.1")
    seven = tuple(Decimal(index) for index in range(7))
    eight = tuple(Decimal(index) for index in range(8))
    assert surprise_z_score(Decimal("8"), prior_surprises=seven) is None
    assert surprise_z_score(Decimal("8"), prior_surprises=eight) == Decimal(
        "1.837117"
    )


def test_event_risk_uses_impact_time_and_portfolio_sensitivity() -> None:
    assert event_risk_score(
        impact="high",
        event_at=NOW + timedelta(hours=12),
        now=NOW,
        portfolio_sensitivity=Decimal("0.8"),
    ) == Decimal("80.00")
    assert event_risk_score(
        impact="medium",
        event_at=NOW + timedelta(days=3),
        now=NOW,
        portfolio_sensitivity=Decimal("1"),
    ) == Decimal("42.00")
    assert event_risk_score(
        impact="low",
        event_at=NOW + timedelta(days=7),
        now=NOW,
        portfolio_sensitivity=Decimal("1"),
    ) == Decimal("10.00")
    assert event_risk_score(
        impact="high",
        event_at=NOW + timedelta(days=7, seconds=1),
        now=NOW,
        portfolio_sensitivity=Decimal("1"),
    ) == Decimal("0.00")
    assert market_event_risk((Decimal("42"), Decimal("80"), Decimal("10"))) == Decimal("80")


def test_event_risk_rejects_invalid_sensitivity_and_naive_time() -> None:
    with pytest.raises(ValueError, match="sensitivity"):
        event_risk_score(
            impact="high",
            event_at=NOW,
            now=NOW,
            portfolio_sensitivity=Decimal("0.4"),
        )
    with pytest.raises(ValueError, match="timezone-aware"):
        event_risk_score(
            impact="high",
            event_at=NOW.replace(tzinfo=None),
            now=NOW,
            portfolio_sensitivity=Decimal("1"),
        )


def test_surprise_registry_maps_only_approved_directional_events() -> None:
    growth = classify_surprise_event("US", "USD", "Nonfarm Payrolls")
    claims = classify_surprise_event("US", "USD", "Unemployment Claims")
    inflation = classify_surprise_event("US", "USD", "Core CPI m/m")
    assert growth is not None and growth.category == "growth" and growth.direction == 1
    assert claims is not None and claims.category == "growth" and claims.direction == -1
    assert inflation is not None and inflation.category == "inflation" and inflation.direction == -1
    assert inflation.series_key.endswith(":core-cpi-m-m")
    assert classify_surprise_event("US", "USD", "Fed Chair Speaks") is None
    assert sum(MACRO_GROUP_WEIGHTS.values(), Decimal("0")) == Decimal("1.00")


def test_m2_change_is_registered_without_changing_macro_regime_components() -> None:
    definition = METRIC_DEFINITIONS_BY_CODE["macro.m2_change_4w"]
    assert definition.direction == 1
    assert definition.unit == "%"
    assert definition.frequency == "weekly"
    assert "macro.m2_change_4w" not in COMPONENT_WEIGHTS
