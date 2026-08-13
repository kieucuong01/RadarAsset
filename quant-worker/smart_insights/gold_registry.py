from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from types import MappingProxyType

from .sources import source_for_code


GOLD_GROUP_WEIGHTS = {
    "momentum": Decimal("0.20"),
    "real_yields": Decimal("0.25"),
    "usd_pressure": Decimal("0.20"),
    "etf_flow": Decimal("0.15"),
    "cftc_positioning": Decimal("0.10"),
    "central_bank_demand": Decimal("0.10"),
}


@dataclass(frozen=True, slots=True)
class GoldMetricDefinition:
    code: str
    group: str
    direction: int
    freshness_sla_minutes: int
    frequency: str


_GOLD_METRIC_ROWS = (
    ("gold.xau_return_1d", "momentum", 1, 4_320, "daily"),
    ("gold.xau_momentum_20d", "momentum", 1, 4_320, "daily"),
    ("macro.real_yield.10y_pct", "real_yields", -1, 4_320, "daily"),
    ("macro.usd_broad_index", "usd_pressure", -1, 4_320, "daily"),
    ("gold.etf_flow_tonnes", "etf_flow", 1, 20_160, "source_period"),
    ("gold.cftc_managed_money_net", "cftc_positioning", 1, 14_400, "weekly"),
    (
        "gold.central_bank_net_purchase_tonnes",
        "central_bank_demand",
        1,
        172_800,
        "source_period",
    ),
)

GOLD_METRICS = MappingProxyType(
    {
        code: GoldMetricDefinition(code, group, direction, sla, frequency)
        for code, group, direction, sla, frequency in _GOLD_METRIC_ROWS
    }
)

GOLD_SOURCE_CODES = (
    "wgc-gold-etf",
    "wgc-central-bank",
    "cftc-disaggregated",
    "fred",
)


def validate_gold_registry() -> None:
    if sum(GOLD_GROUP_WEIGHTS.values(), Decimal("0")) != Decimal("1.00"):
        raise ValueError("Gold group weights must sum to 1.00.")
    if {row.group for row in GOLD_METRICS.values()} != set(GOLD_GROUP_WEIGHTS):
        raise ValueError("Every Gold score group must have a metric.")
    for code in GOLD_SOURCE_CODES:
        if source_for_code(code).code != code:
            raise ValueError("Gold source is not registered.")


validate_gold_registry()
