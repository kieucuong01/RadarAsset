from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
import re

from smart_insights.macro_registry import CFTC_MARKETS, FRED_SERIES

from .common import rolling_z_score
from .crypto import MetricDefinitionInput


METHODOLOGY_VERSION = "macro-risk-asset-regime-v1"

MACRO_GROUP_WEIGHTS = {
    "liquidity": Decimal("0.30"),
    "rates_real_yields": Decimal("0.25"),
    "usd_pressure": Decimal("0.20"),
    "growth_inflation_surprise": Decimal("0.15"),
    "positioning": Decimal("0.10"),
}

MACRO_GROUP_COMPONENTS = {
    "liquidity": (
        "macro.fed_balance_sheet_change_4w",
        "macro.reverse_repo_change_4w",
        "macro.tga_change_4w",
    ),
    "rates_real_yields": (
        "macro.yield.2y_pct",
        "macro.yield.10y_pct",
        "macro.real_yield.10y_pct",
    ),
    "usd_pressure": ("macro.usd_broad_index",),
    "growth_inflation_surprise": (
        "macro.growth_surprise",
        "macro.inflation_surprise",
    ),
    "positioning": (
        "macro.cftc.btc_net_oi",
        "macro.cftc.usd_index_net_oi",
        "macro.cftc.sp500_net_oi",
        "macro.cftc.nasdaq100_net_oi",
    ),
}

COMPONENT_WEIGHTS = {
    component: MACRO_GROUP_WEIGHTS[group] / Decimal(len(components))
    for group, components in MACRO_GROUP_COMPONENTS.items()
    for component in components
}


def _definition(
    code: str,
    name: str,
    unit: str,
    frequency: str,
    direction: int,
    freshness_sla_minutes: int,
    **metadata: object,
) -> MetricDefinitionInput:
    return MetricDefinitionInput(
        code=code,
        name=name,
        unit=unit,
        frequency=frequency,
        direction=direction,
        freshness_sla_minutes=freshness_sla_minutes,
        market="macro",
        methodology_version=METHODOLOGY_VERSION,
        metadata=metadata,
    )


_FRED_DEFINITIONS = tuple(
    _definition(
        series.metric_code,
        series.name,
        series.unit,
        series.frequency,
        series.direction,
        10_080 if series.frequency == "weekly" else 4_320,
        source="fred",
        provider_series=series.series_id,
        evidence_only=series.metric_code
        not in {
            "macro.yield.2y_pct",
            "macro.yield.10y_pct",
            "macro.real_yield.10y_pct",
            "macro.fed_balance_sheet_musd",
            "macro.reverse_repo_busd",
            "macro.tga_busd",
            "macro.usd_broad_index",
        },
    )
    for series in FRED_SERIES.values()
)

_CFTC_DEFINITIONS = tuple(
    _definition(
        metric_code,
        f"{market.market_code} CFTC {label}",
        unit,
        "weekly",
        direction,
        14_400,
        source=market.source_code,
        contract_market_code=market.contract_market_code,
        evidence_only=metric_code != market.net_oi_metric,
    )
    for market in CFTC_MARKETS.values()
    if market.market_code != "GOLD"
    for metric_code, label, unit, direction in (
        (f"{market.metric_prefix}.open_interest", "open interest", "contracts", 0),
        (f"{market.metric_prefix}.long_contracts", "long positions", "contracts", 0),
        (f"{market.metric_prefix}.short_contracts", "short positions", "contracts", 0),
        (f"{market.metric_prefix}.net_contracts", "net positions", "contracts", 0),
        (
            market.net_oi_metric,
            "net positions over open interest",
            "ratio",
            -1 if market.market_code == "USD_INDEX" else 1,
        ),
    )
)

_DERIVED_DEFINITIONS = (
    _definition("macro.fed_balance_sheet_change_4w", "Fed balance sheet 4-week change", "USD million", "weekly", 1, 10_080, lookback_days=28),
    _definition("macro.reverse_repo_change_4w", "Reverse repo 4-week change", "USD billion", "daily", -1, 4_320, lookback_days=28),
    _definition("macro.tga_change_4w", "Treasury General Account 4-week change", "USD billion", "weekly", -1, 10_080, lookback_days=28),
    _definition("macro.growth_surprise", "Growth release surprise", "z_score", "event", 1, 10_080, source="cryptocraft"),
    _definition("macro.inflation_surprise", "Inflation release surprise", "z_score", "event", -1, 10_080, source="cryptocraft"),
    _definition("macro.regime.score", "Macro Risk-Asset Regime Score", "score", "daily", 1, 4_320),
    _definition("macro.event_risk", "Macro Event Risk", "score", "event", 0, 120, source="cryptocraft"),
)

MACRO_METRIC_DEFINITIONS = _FRED_DEFINITIONS + _CFTC_DEFINITIONS + _DERIVED_DEFINITIONS
METRIC_DEFINITIONS_BY_CODE = {
    definition.code: definition for definition in MACRO_METRIC_DEFINITIONS
}

_RELEASE = re.compile(r"^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([KMBT])?(%)?$", re.I)
_MULTIPLIERS = {
    None: Decimal("1"),
    "K": Decimal("1000"),
    "M": Decimal("1000000"),
    "B": Decimal("1000000000"),
    "T": Decimal("1000000000000"),
}


def parse_release_number(value: str, *, decimal_comma: bool = False) -> Decimal:
    cleaned = "".join(value.split())
    if "," in cleaned:
        if not decimal_comma or cleaned.count(",") != 1 or "." in cleaned:
            raise ValueError("DECIMAL_COMMA_NOT_DECLARED")
        cleaned = cleaned.replace(",", ".")
    match = _RELEASE.fullmatch(cleaned)
    if match is None:
        raise ValueError("INVALID_RELEASE_VALUE")
    try:
        number = Decimal(match.group(1))
    except InvalidOperation as error:
        raise ValueError("INVALID_RELEASE_VALUE") from error
    if not number.is_finite():
        raise ValueError("INVALID_RELEASE_VALUE")
    return number * _MULTIPLIERS[match.group(2).upper() if match.group(2) else None]


def release_surprise(actual: Decimal, forecast: Decimal) -> Decimal:
    if not actual.is_finite() or not forecast.is_finite():
        raise ValueError("Release values must be finite.")
    return actual - forecast


def surprise_z_score(
    current: Decimal, *, prior_surprises: Sequence[Decimal]
) -> Decimal | None:
    if len(prior_surprises) < 8:
        return None
    return rolling_z_score(tuple(prior_surprises), current)


def event_risk_score(
    *,
    impact: str,
    event_at: datetime,
    now: datetime,
    portfolio_sensitivity: Decimal,
) -> Decimal:
    if (
        event_at.tzinfo is None
        or event_at.utcoffset() is None
        or now.tzinfo is None
        or now.utcoffset() is None
    ):
        raise ValueError("Event risk timestamps must be timezone-aware.")
    if not Decimal("0.5") <= portfolio_sensitivity <= Decimal("1.0"):
        raise ValueError("Portfolio sensitivity must be between 0.5 and 1.0.")
    severity = {
        "high": Decimal("100"),
        "medium": Decimal("60"),
        "low": Decimal("25"),
    }.get(impact)
    if severity is None:
        raise ValueError("Event impact is not supported.")
    distance = event_at - now
    if distance < timedelta(0):
        factor = Decimal("0")
    elif distance <= timedelta(hours=24):
        factor = Decimal("1.0")
    elif distance <= timedelta(days=3):
        factor = Decimal("0.7")
    elif distance <= timedelta(days=7):
        factor = Decimal("0.4")
    else:
        factor = Decimal("0")
    return (severity * factor * portfolio_sensitivity).quantize(Decimal("0.01"))


def market_event_risk(scores: Sequence[Decimal]) -> Decimal:
    if any(score < 0 or score > 100 for score in scores):
        raise ValueError("Event risk scores must be between zero and 100.")
    return max(scores, default=Decimal("0"))
