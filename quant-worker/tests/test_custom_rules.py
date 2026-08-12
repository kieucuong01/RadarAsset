from decimal import Decimal

import pytest

from backtest.custom_rules import PriceThresholdRule, ScheduledDcaRule, parse_custom_rule


def test_parses_allow_listed_price_threshold_rule() -> None:
    rule = parse_custom_rule(
        {
            "schemaVersion": 1,
            "kind": "price_threshold",
            "operator": "crosses_above",
            "threshold": 100,
            "currency": "USD",
            "action": "buy",
            "sizePct": 25,
        }
    )

    assert rule == PriceThresholdRule(
        operator="crosses_above",
        threshold=Decimal("100"),
        currency="USD",
        action="buy",
        size_pct=Decimal("25"),
    )


def test_parses_allow_listed_monthly_dca_rule() -> None:
    rule = parse_custom_rule(
        {
            "schemaVersion": 1,
            "kind": "scheduled_dca",
            "contributionAmount": 400,
            "currency": "VND",
            "frequency": "monthly",
            "dayOfMonth": 15,
        }
    )

    assert rule == ScheduledDcaRule(
        contribution_amount=Decimal("400"),
        currency="VND",
        day_of_month=15,
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"schemaVersion": 1, "kind": "scheduled_dca", "contributionAmount": 0, "currency": "USD", "frequency": "monthly", "dayOfMonth": 15},
        {"schemaVersion": 1, "kind": "scheduled_dca", "contributionAmount": 400, "currency": "USD", "frequency": "monthly", "dayOfMonth": 29},
        {"schemaVersion": 1, "kind": "price_threshold", "operator": "crosses_above", "threshold": 100, "currency": "USD", "action": "buy", "sizePct": 101},
        {"schemaVersion": 1, "kind": "price_threshold", "operator": "crosses_above", "threshold": 100, "currency": "USD", "action": "buy", "sizePct": 25, "extra": True},
    ],
)
def test_rejects_rules_outside_the_typescript_contract(payload: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        parse_custom_rule(payload)
