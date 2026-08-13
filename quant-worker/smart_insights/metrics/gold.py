from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, localcontext
from typing import Sequence

from smart_insights.gold_registry import GOLD_GROUP_WEIGHTS

from .common import (
    InsufficientCoverageError,
    annualized_volatility,
    drawdown,
    empirical_percentile,
    simple_return,
)
from .crypto import MetricDefinitionInput


_SIX = Decimal("0.000001")
METHODOLOGY_VERSION = "gold-regime-v1"


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
        market="gold",
        methodology_version=METHODOLOGY_VERSION,
        metadata=metadata,
    )


GOLD_METRIC_DEFINITIONS = (
    _definition("gold.etf_flow_tonnes", "Global Gold ETF flow", "tonnes", "source_period", 1, 20_160, source="wgc-gold-etf"),
    _definition("gold.etf_holdings_tonnes", "Global Gold ETF holdings", "tonnes", "source_period", 0, 20_160, source="wgc-gold-etf", evidence_only=True),
    _definition("gold.central_bank_net_purchase_tonnes", "Central bank net Gold purchases", "tonnes", "source_period", 1, 172_800, source="wgc-central-bank"),
    _definition("gold.cftc.managed_money.open_interest", "Gold CFTC open interest", "contracts", "weekly", 0, 14_400, source="cftc-disaggregated", evidence_only=True),
    _definition("gold.cftc.managed_money.long_contracts", "Gold CFTC managed money longs", "contracts", "weekly", 0, 14_400, source="cftc-disaggregated", evidence_only=True),
    _definition("gold.cftc.managed_money.short_contracts", "Gold CFTC managed money shorts", "contracts", "weekly", 0, 14_400, source="cftc-disaggregated", evidence_only=True),
    _definition("gold.cftc.managed_money.net_contracts", "Gold CFTC managed money net", "contracts", "weekly", 0, 14_400, source="cftc-disaggregated", evidence_only=True),
    _definition("gold.cftc.managed_money_net_oi", "Gold CFTC managed money normalized net", "ratio", "weekly", 1, 14_400, source="cftc-disaggregated"),
    _definition("gold.xau_return_1d", "XAU one-day return", "return", "daily", 1, 4_320, source="active_dataset"),
    _definition("gold.xau_momentum_20d", "XAU 20-day momentum", "return", "daily", 1, 4_320, source="active_dataset"),
    _definition("gold.regime.score", "Gold Regime Score", "score", "daily", 1, 4_320),
)


@dataclass(frozen=True, slots=True)
class GoldPricePoint:
    date: date
    close: Decimal
    dataset_version_id: str

    def __post_init__(self) -> None:
        if self.close <= 0 or not self.close.is_finite():
            raise ValueError("Gold close must be positive and finite.")
        if not self.dataset_version_id:
            raise ValueError("Gold price row requires a dataset version.")


@dataclass(frozen=True, slots=True)
class GoldPriceMetrics:
    effective_date: date
    return_1d: Decimal | None
    momentum_20d: Decimal | None
    momentum_60d: Decimal | None
    momentum_120d: Decimal | None
    volatility_20d: Decimal | None
    drawdown_from_peak: Decimal
    dataset_version_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class DatedPoint:
    date: date
    value: Decimal
    dataset_version_id: str

    def __post_init__(self) -> None:
        if not self.value.is_finite():
            raise ValueError("Dated point value must be finite.")
        if not self.dataset_version_id:
            raise ValueError("Dated point requires an input version.")


@dataclass(frozen=True, slots=True)
class CrossAssetMetric:
    benchmark: str
    window: int
    effective_date: date | None
    value: Decimal | None
    point_count: int
    input_dataset_versions: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CftcPositionMetrics:
    net_contracts: Decimal
    normalized_net: Decimal
    weekly_delta: Decimal | None
    expanding_percentile: Decimal


@dataclass(frozen=True, slots=True)
class GoldRegimeInput:
    score: Decimal
    confidence: Decimal
    input_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not Decimal("-100") <= self.score <= Decimal("100"):
            raise ValueError("Gold group score must be between -100 and 100.")
        if not Decimal("0") <= self.confidence <= Decimal("100"):
            raise ValueError("Gold confidence must be between zero and 100.")
        if not self.input_ids:
            raise ValueError("Gold group input IDs are required.")


@dataclass(frozen=True, slots=True)
class GoldRegimeResult:
    score: Decimal
    label: str
    configured_weight_coverage: Decimal
    data_confidence: Decimal
    input_ids: tuple[str, ...]


def calculate_xau_metrics(
    rows: Sequence[GoldPricePoint], *, as_of: date
) -> GoldPriceMetrics:
    if not rows:
        raise ValueError("Gold price history is empty.")
    ordered = tuple(sorted(rows, key=lambda row: row.date))
    if len({row.date for row in ordered}) != len(ordered):
        raise ValueError("Duplicate Gold price date.")
    if ordered[-1].date > as_of:
        raise ValueError("Gold price history contains a future row.")
    versions = tuple(sorted({row.dataset_version_id for row in ordered}))
    if len(versions) != 1:
        raise ValueError("Gold inputs must come from one active dataset version.")
    closes = tuple(row.close for row in ordered)

    def momentum(lookback: int) -> Decimal | None:
        if len(closes) <= lookback:
            return None
        return simple_return(closes[-lookback - 1], closes[-1])

    volatility = (
        annualized_volatility(closes[-21:], periods_per_year=252)
        if len(closes) >= 21
        else None
    )
    current_drawdown = drawdown(closes)
    assert current_drawdown is not None
    return GoldPriceMetrics(
        effective_date=ordered[-1].date,
        return_1d=(simple_return(closes[-2], closes[-1]) if len(closes) >= 2 else None),
        momentum_20d=momentum(20),
        momentum_60d=momentum(60),
        momentum_120d=momentum(120),
        volatility_20d=volatility,
        drawdown_from_peak=current_drawdown,
        dataset_version_ids=versions,
    )


def _joined(
    y: Sequence[DatedPoint], x: Sequence[DatedPoint]
) -> tuple[tuple[date, Decimal, Decimal], ...]:
    if len({row.date for row in y}) != len(y) or len({row.date for row in x}) != len(x):
        raise ValueError("Cross-asset inputs contain duplicate dates.")
    y_by_date = {row.date: row.value for row in y}
    x_by_date = {row.date: row.value for row in x}
    return tuple(
        (current_date, y_by_date[current_date], x_by_date[current_date])
        for current_date in sorted(set(y_by_date) & set(x_by_date))
    )


def _versions(y: Sequence[DatedPoint], x: Sequence[DatedPoint]) -> tuple[str, ...]:
    return tuple(sorted({row.dataset_version_id for row in (*y, *x)}))


def _metric(
    y: Sequence[DatedPoint],
    x: Sequence[DatedPoint],
    *,
    minimum_points: int,
    operation: str,
) -> CrossAssetMetric:
    if minimum_points < 2:
        raise ValueError("minimum_points must be at least two.")
    joined = _joined(y, x)
    effective_date = joined[-1][0] if joined else None
    input_versions = _versions(y, x)
    if len(joined) < minimum_points:
        return CrossAssetMetric("aligned", len(joined), effective_date, None, len(joined), input_versions)
    with localcontext() as context:
        context.prec = 34
        y_values = tuple(row[1] for row in joined)
        x_values = tuple(row[2] for row in joined)
        y_mean = sum(y_values, Decimal("0")) / Decimal(len(y_values))
        x_mean = sum(x_values, Decimal("0")) / Decimal(len(x_values))
        covariance = sum(
            ((y_value - y_mean) * (x_value - x_mean) for y_value, x_value in zip(y_values, x_values)),
            Decimal("0"),
        ) / Decimal(len(joined) - 1)
        y_variance = sum(((value - y_mean) ** 2 for value in y_values), Decimal("0")) / Decimal(len(joined) - 1)
        x_variance = sum(((value - x_mean) ** 2 for value in x_values), Decimal("0")) / Decimal(len(joined) - 1)
        if x_variance == 0 or (operation == "correlation" and y_variance == 0):
            value = None
        elif operation == "beta":
            value = (covariance / x_variance).quantize(_SIX)
        else:
            value = (covariance / (x_variance * y_variance).sqrt()).quantize(_SIX)
    return CrossAssetMetric("aligned", len(joined), effective_date, value, len(joined), input_versions)


def aligned_correlation(
    y: Sequence[DatedPoint], x: Sequence[DatedPoint], *, minimum_points: int = 60
) -> CrossAssetMetric:
    return _metric(y, x, minimum_points=minimum_points, operation="correlation")


def aligned_beta(
    y: Sequence[DatedPoint], x: Sequence[DatedPoint], *, minimum_points: int = 60
) -> CrossAssetMetric:
    return _metric(y, x, minimum_points=minimum_points, operation="beta")


def cftc_position_metrics(
    *,
    long_position: Decimal,
    short_position: Decimal,
    open_interest: Decimal,
    prior_normalized_net: Sequence[Decimal],
) -> CftcPositionMetrics:
    if open_interest <= 0 or long_position < 0 or short_position < 0:
        raise ValueError("CFTC position values are invalid.")
    with localcontext() as context:
        context.prec = 34
        net = long_position - short_position
        normalized = (net / open_interest).quantize(_SIX)
        delta = (
            (normalized - prior_normalized_net[-1]).quantize(_SIX)
            if prior_normalized_net
            else None
        )
        percentile = empirical_percentile(
            tuple(prior_normalized_net) + (normalized,), normalized
        )
    return CftcPositionMetrics(net, normalized, delta, percentile)


def regime_label(score: Decimal) -> str:
    if score <= Decimal("-40"):
        return "strongly_negative"
    if score <= Decimal("-15"):
        return "negative"
    if score < Decimal("15"):
        return "neutral"
    if score < Decimal("40"):
        return "constructive"
    return "strongly_positive"


def gold_regime(
    inputs: dict[str, GoldRegimeInput],
    *,
    minimum_coverage: Decimal = Decimal("0.60"),
) -> GoldRegimeResult:
    unknown = set(inputs) - set(GOLD_GROUP_WEIGHTS)
    if unknown:
        raise ValueError("Gold regime received an unknown score group.")
    valid_weight = sum(
        (GOLD_GROUP_WEIGHTS[group] for group in inputs), Decimal("0")
    )
    total_weight = sum(GOLD_GROUP_WEIGHTS.values(), Decimal("0"))
    coverage = valid_weight / total_weight
    if coverage < minimum_coverage or valid_weight == 0:
        raise InsufficientCoverageError("Gold score coverage is below 60%.")
    with localcontext() as context:
        context.prec = 34
        score = (
            sum(
                (
                    GOLD_GROUP_WEIGHTS[group] * row.score
                    for group, row in inputs.items()
                ),
                Decimal("0"),
            )
            / valid_weight
        ).quantize(Decimal("0.01"))
        confidence = (
            sum(
                (
                    GOLD_GROUP_WEIGHTS[group] * row.confidence
                    for group, row in inputs.items()
                ),
                Decimal("0"),
            )
            / total_weight
        ).quantize(Decimal("0.01"))
    return GoldRegimeResult(
        score=score,
        label=regime_label(score),
        configured_weight_coverage=coverage.quantize(Decimal("0.01")),
        data_confidence=min(Decimal("100"), confidence),
        input_ids=tuple(
            sorted({input_id for row in inputs.values() for input_id in row.input_ids})
        ),
    )
