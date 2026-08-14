from __future__ import annotations

from datetime import datetime, timezone

import pytest

from smart_insights.metrics.energy import (
    OilShockComponent,
    OilShockInputs,
    calculate_oil_shock,
    realized_volatility,
    z_score_against_history,
)


NOW = datetime(2026, 8, 14, tzinfo=timezone.utc)


def component(name: str, value: float, *, fresh: bool = True) -> OilShockComponent:
    return OilShockComponent(name, value, NOW, fresh, (f"evidence:{name}",))


def test_oil_shock_v1_uses_fixed_weights_and_branch_label() -> None:
    result = calculate_oil_shock(OilShockInputs(NOW, {
        "oil_return_7d_z": component("oil_return_7d_z", 80),
        "oil_volatility_z": component("oil_volatility_z", 60),
        "inventory_surprise_or_change_z": component("inventory_surprise_or_change_z", 70),
        "brent_wti_spread_z": component("brent_wti_spread_z", 50),
    }, inventory_branch="change_anomaly"))

    assert result.status == "AVAILABLE"
    assert result.value == pytest.approx(68.0)
    assert result.inventory_branch == "change_anomaly"
    assert result.methodology == "energy-oil-shock-v1"


def test_oil_shock_withholds_below_sixty_percent_fresh_weight() -> None:
    result = calculate_oil_shock(OilShockInputs(NOW, {
        "oil_return_7d_z": component("oil_return_7d_z", 80),
        "oil_volatility_z": component("oil_volatility_z", 60, fresh=False),
        "inventory_surprise_or_change_z": component("inventory_surprise_or_change_z", 70, fresh=False),
        "brent_wti_spread_z": component("brent_wti_spread_z", 50),
    }, inventory_branch="forecast_surprise"))

    assert result.status == "UNAVAILABLE"
    assert result.value is None
    assert result.coverage == pytest.approx(0.50)


def test_realized_volatility_uses_twenty_returns_and_zscore_uses_history() -> None:
    prices = [100 + index + (index % 3) for index in range(21)]
    assert realized_volatility(prices, window=20) > 0
    history = [float(index) for index in range(1, 91)]
    assert z_score_against_history(100.0, history, required_history=90) > 1
    with pytest.raises(ValueError, match="90"):
        z_score_against_history(10.0, history[:89], required_history=90)
