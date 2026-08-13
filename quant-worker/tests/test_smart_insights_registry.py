from __future__ import annotations

from decimal import Decimal

from smart_insights.gold_registry import (
    GOLD_GROUP_WEIGHTS,
    GOLD_METRICS,
    GOLD_SOURCE_CODES,
)
from smart_insights.sources import source_for_code


def test_gold_registry_freezes_weights_direction_and_frequency() -> None:
    assert GOLD_GROUP_WEIGHTS == {
        "momentum": Decimal("0.25"),
        "real_yields": Decimal("0.30"),
        "usd_pressure": Decimal("0.25"),
        "cftc_positioning": Decimal("0.20"),
    }
    assert GOLD_METRICS["macro.real_yield.10y_pct"].direction == -1
    assert GOLD_METRICS["macro.usd_broad_index"].direction == -1
    assert GOLD_METRICS["gold.cftc.managed_money_net_oi"].frequency == "weekly"


def test_gold_sources_resolve_through_the_foundation_registry() -> None:
    assert GOLD_SOURCE_CODES == (
        "cftc-disaggregated",
        "fred",
    )
    assert all(source_for_code(code).code == code for code in GOLD_SOURCE_CODES)


def test_gold_weights_and_component_contract_are_complete() -> None:
    assert sum(GOLD_GROUP_WEIGHTS.values(), Decimal("0")) == Decimal("1.00")
    assert {row.group for row in GOLD_METRICS.values()} == set(GOLD_GROUP_WEIGHTS)
    assert all(row.freshness_sla_minutes > 0 for row in GOLD_METRICS.values())
