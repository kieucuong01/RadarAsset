from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from decimal import Decimal, localcontext
from typing import Any

from .adjustments import AdjustmentUnavailable
from .corporate_actions import CorporateActionRecord


@dataclass(frozen=True)
class IndependentFactors:
    price: Decimal
    quantity: Decimal


def independent_event_factors(
    previous_close: Decimal,
    actions: Iterable[CorporateActionRecord],
    *,
    cash_value_scale: Decimal = Decimal("1"),
) -> IndependentFactors:
    if previous_close <= 0 or cash_value_scale <= 0:
        raise AdjustmentUnavailable("Audit inputs must be positive.")
    cash = Decimal(0)
    new_shares = Decimal(0)
    subscription_value = Decimal(0)
    for action in actions:
        if action.status != "verified":
            raise AdjustmentUnavailable("Audit requires verified corporate actions.")
        if action.action_type == "cash_dividend":
            if action.cash_per_share is None:
                raise AdjustmentUnavailable("Cash dividend terms are incomplete.")
            cash += action.cash_per_share / cash_value_scale
        elif action.action_type in {"stock_dividend", "split"}:
            if action.distribution_ratio is None:
                raise AdjustmentUnavailable("Share distribution terms are incomplete.")
            new_shares += action.distribution_ratio
        elif action.action_type == "rights_issue":
            if action.subscription_ratio is None or action.subscription_price is None:
                raise AdjustmentUnavailable("Rights issue terms are incomplete.")
            new_shares += action.subscription_ratio
            subscription_value += (
                action.subscription_ratio * action.subscription_price / cash_value_scale
            )
        elif action.action_type == "symbol_change":
            continue
    with localcontext() as context:
        context.prec = 36
        quantity = Decimal(1) + new_shares
        theoretical_ex_price = (previous_close - cash + subscription_value) / quantity
        price = theoretical_ex_price / previous_close
    if price <= 0 or quantity <= 0:
        raise AdjustmentUnavailable("Audit produced an invalid factor.")
    return IndependentFactors(price=price, quantity=quantity)


def audit_adjusted_observation(
    *,
    raw_close: Decimal,
    adjusted_close: Decimal,
    raw_volume: Decimal | None,
    adjusted_volume: Decimal | None,
    actions: Iterable[CorporateActionRecord],
    cash_value_scale: Decimal = Decimal("1"),
    tolerance: Decimal = Decimal("0.00000001"),
) -> dict[str, str]:
    factors = independent_event_factors(
        raw_close, actions, cash_value_scale=cash_value_scale
    )
    price_delta = adjusted_close - raw_close * factors.price
    quantity_delta = Decimal(0)
    if raw_volume is not None and adjusted_volume is not None:
        quantity_delta = adjusted_volume - raw_volume * factors.quantity
    status = (
        "passed"
        if abs(price_delta) <= tolerance and abs(quantity_delta) <= tolerance
        else "failed"
    )
    return {
        "status": status,
        "priceDelta": str(price_delta),
        "quantityDelta": str(quantity_delta),
    }


def audit_adjusted_factors(
    *,
    raw_close: Decimal,
    adjusted_close: Decimal,
    raw_volume: Decimal | None,
    adjusted_volume: Decimal | None,
    factors: Iterable[IndependentFactors],
    tolerance: Decimal = Decimal("0.00000001"),
) -> dict[str, str]:
    price = Decimal(1)
    quantity = Decimal(1)
    for item in factors:
        price *= item.price
        quantity *= item.quantity
    price_delta = adjusted_close - raw_close * price
    quantity_delta = Decimal(0)
    if raw_volume is not None and adjusted_volume is not None:
        quantity_delta = adjusted_volume - raw_volume * quantity
    return {
        "status": (
            "passed"
            if abs(price_delta) <= tolerance and abs(quantity_delta) <= tolerance
            else "failed"
        ),
        "priceDelta": str(price_delta),
        "quantityDelta": str(quantity_delta),
    }


def select_audit_basket(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, str]]:
    ordered = sorted(rows, key=lambda row: str(row["symbol"]))
    result: list[dict[str, str]] = []
    for category in ("cash_dividend", "stock_dividend", "split", "rights_issue"):
        match = next((row for row in ordered if row.get("actionType") == category), None)
        if match:
            result.append({"category": category, "symbol": str(match["symbol"])})
    inactive = next(
        (row for row in ordered if row.get("listingStatus") != "active"), None
    )
    if inactive:
        result.append({"category": "inactive", "symbol": str(inactive["symbol"])})
    unresolved = next(
        (row for row in ordered if row.get("status") != "verified"), None
    )
    if unresolved:
        result.append({"category": "unresolved", "symbol": str(unresolved["symbol"])})
    return result
