from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import hashlib
import json
from typing import Any, Literal


MAX_VALUE = Decimal("1000000000000")


@dataclass(frozen=True)
class PriceThresholdRule:
    operator: Literal["crosses_above", "crosses_below"]
    threshold: Decimal
    currency: Literal["USD", "VND"]
    action: Literal["buy", "sell"]
    size_pct: Decimal


@dataclass(frozen=True)
class ScheduledDcaRule:
    contribution_amount: Decimal
    currency: Literal["USD", "VND"]
    day_of_month: int
    frequency: Literal["monthly"] = "monthly"


CustomRule = PriceThresholdRule | ScheduledDcaRule


def _decimal(value: object, *, minimum: Decimal, maximum: Decimal) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ValueError("Custom rule number is invalid.")
    try:
        result = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError("Custom rule number is invalid.") from error
    if not result.is_finite() or not minimum <= result <= maximum:
        raise ValueError("Custom rule number is invalid.")
    return result


def parse_custom_rule(value: object) -> CustomRule:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("Custom rule schema is invalid.")
    kind = value.get("kind")
    if kind == "price_threshold":
        if set(value) != {
            "schemaVersion", "kind", "operator", "threshold", "currency", "action", "sizePct"
        }:
            raise ValueError("Price threshold rule fields are invalid.")
        operator = value.get("operator")
        currency = value.get("currency")
        action = value.get("action")
        if operator not in {"crosses_above", "crosses_below"}:
            raise ValueError("Price threshold operator is invalid.")
        if currency not in {"USD", "VND"} or action not in {"buy", "sell"}:
            raise ValueError("Price threshold rule is invalid.")
        return PriceThresholdRule(
            operator=operator,
            threshold=_decimal(value.get("threshold"), minimum=Decimal("0.00000001"), maximum=MAX_VALUE),
            currency=currency,
            action=action,
            size_pct=_decimal(value.get("sizePct"), minimum=Decimal("0.00000001"), maximum=Decimal("100")),
        )
    if kind == "scheduled_dca":
        if set(value) != {
            "schemaVersion", "kind", "contributionAmount", "currency", "frequency", "dayOfMonth"
        }:
            raise ValueError("DCA rule fields are invalid.")
        currency = value.get("currency")
        day = value.get("dayOfMonth")
        if currency not in {"USD", "VND"} or value.get("frequency") != "monthly":
            raise ValueError("DCA rule is invalid.")
        if isinstance(day, bool) or not isinstance(day, int) or not 1 <= day <= 28:
            raise ValueError("DCA schedule is invalid.")
        return ScheduledDcaRule(
            contribution_amount=_decimal(value.get("contributionAmount"), minimum=Decimal("0.00000001"), maximum=MAX_VALUE),
            currency=currency,
            day_of_month=day,
        )
    raise ValueError("Unsupported custom strategy kind.")


def custom_rule_implementation_hash(value: object) -> str:
    parse_custom_rule(value)
    encoded = json.dumps(
        value,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
