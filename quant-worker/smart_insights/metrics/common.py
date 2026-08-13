from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, localcontext


_SIX_PLACES = Decimal("0.000001")
_TWO_PLACES = Decimal("0.01")


class InsufficientCoverageError(ValueError):
    """Raised when configured score coverage is below its publication gate."""


@dataclass(frozen=True, slots=True)
class ConfidenceInput:
    configured_weight: Decimal
    quality_tier: Decimal
    age_minutes: Decimal
    freshness_sla_minutes: Decimal
    validation_status: str


@dataclass(frozen=True, slots=True)
class RevisionedValue:
    observed_at: datetime
    revision: int
    value: Decimal

    def __post_init__(self) -> None:
        if self.observed_at.tzinfo is None or self.observed_at.utcoffset() is None:
            raise ValueError("observed_at must be timezone-aware.")
        if self.revision <= 0:
            raise ValueError("revision must be positive.")


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(_SIX_PLACES)


def simple_return(previous: Decimal, current: Decimal) -> Decimal:
    if previous == 0:
        raise ValueError("Previous value must be non-zero.")
    with localcontext() as context:
        context.prec = 34
        return _quantize(current / previous - Decimal("1"))


def annualized_volatility(
    closes: Sequence[Decimal], *, periods_per_year: int = 365
) -> Decimal | None:
    if periods_per_year <= 0:
        raise ValueError("periods_per_year must be positive.")
    if len(closes) < 3:
        return None
    if any(value <= 0 for value in closes):
        raise ValueError("Volatility inputs must be positive.")

    with localcontext() as context:
        context.prec = 34
        returns = tuple(
            (current / previous).ln()
            for previous, current in zip(closes, closes[1:])
        )
        mean = sum(returns, Decimal("0")) / Decimal(len(returns))
        variance = sum(
            ((value - mean) ** 2 for value in returns), Decimal("0")
        ) / Decimal(len(returns) - 1)
        return _quantize(variance.sqrt() * Decimal(periods_per_year).sqrt())


def drawdown(closes: Sequence[Decimal]) -> Decimal | None:
    if not closes:
        return None
    if any(value <= 0 for value in closes):
        raise ValueError("Drawdown inputs must be positive.")
    with localcontext() as context:
        context.prec = 34
        return _quantize(closes[-1] / max(closes) - Decimal("1"))


def rolling_z_score(
    values: Sequence[Decimal], current: Decimal
) -> Decimal | None:
    if len(values) < 2:
        return None
    with localcontext() as context:
        context.prec = 34
        mean = sum(values, Decimal("0")) / Decimal(len(values))
        variance = sum(
            ((value - mean) ** 2 for value in values), Decimal("0")
        ) / Decimal(len(values) - 1)
        deviation = variance.sqrt()
        if deviation == 0:
            return None
        return _quantize((current - mean) / deviation)


def empirical_percentile(
    values: Sequence[Decimal], current: Decimal
) -> Decimal:
    if not values:
        raise ValueError("Percentile history must not be empty.")
    with localcontext() as context:
        context.prec = 34
        rank = sum(1 for value in values if value <= current)
        return _quantize(Decimal(rank) / Decimal(len(values)))


def signed_percentile_score(percentile: Decimal, direction: int) -> Decimal:
    if direction not in {-1, 0, 1}:
        raise ValueError("Invalid score direction.")
    if not Decimal("0") <= percentile <= Decimal("1"):
        raise ValueError("Percentile must be between zero and one.")
    with localcontext() as context:
        context.prec = 34
        score = (
            Decimal(direction)
            * (Decimal("2") * percentile - Decimal("1"))
            * Decimal("100")
        )
        bounded = max(Decimal("-100"), min(Decimal("100"), score))
        return _quantize(bounded)


def weighted_score(
    values: Mapping[str, Decimal | None],
    weights: Mapping[str, Decimal],
    *,
    minimum_coverage: Decimal = Decimal("0.60"),
) -> Decimal:
    if set(values) != set(weights):
        raise ValueError("Score values and weights must use identical keys.")
    if not Decimal("0") <= minimum_coverage <= Decimal("1"):
        raise ValueError("minimum_coverage must be between zero and one.")
    if any(weight < 0 for weight in weights.values()):
        raise ValueError("Score weights must not be negative.")

    total_weight = sum(weights.values(), Decimal("0"))
    if total_weight <= 0:
        raise ValueError("At least one positive score weight is required.")
    valid_weight = sum(
        (weights[key] for key, value in values.items() if value is not None),
        Decimal("0"),
    )
    coverage = valid_weight / total_weight
    if coverage < minimum_coverage:
        raise InsufficientCoverageError(
            f"Score coverage {coverage} is below {minimum_coverage}."
        )
    if valid_weight == 0:
        raise InsufficientCoverageError("No score inputs are available.")

    with localcontext() as context:
        context.prec = 34
        score = sum(
            (
                weights[key] * value
                for key, value in values.items()
                if value is not None
            ),
            Decimal("0"),
        ) / valid_weight
        bounded = max(Decimal("-100"), min(Decimal("100"), score))
        return _quantize(bounded)


def data_confidence(inputs: Mapping[str, ConfidenceInput]) -> Decimal:
    if not inputs:
        return Decimal("0.00")
    statuses = {
        "passed": Decimal("1"),
        "warning": Decimal("0.7"),
        "quarantined": Decimal("0"),
        "conflicting": Decimal("0"),
    }
    total_weight = sum(
        (row.configured_weight for row in inputs.values()), Decimal("0")
    )
    if total_weight <= 0:
        raise ValueError("Confidence weights must sum to a positive value.")

    weighted_confidence = Decimal("0")
    with localcontext() as context:
        context.prec = 34
        for row in inputs.values():
            if row.configured_weight < 0:
                raise ValueError("Confidence weights must not be negative.")
            if not Decimal("0") < row.quality_tier <= Decimal("1"):
                raise ValueError("quality_tier must be greater than zero and at most one.")
            if row.age_minutes < 0:
                raise ValueError("Observation age must not be negative.")
            if row.freshness_sla_minutes <= 0:
                raise ValueError("Freshness SLA must be positive.")
            if row.validation_status not in statuses:
                raise ValueError("Unknown validation status.")

            if row.age_minutes > row.freshness_sla_minutes:
                freshness = Decimal("0")
            else:
                freshness = Decimal("1") - (
                    Decimal("0.5")
                    * row.age_minutes
                    / row.freshness_sla_minutes
                )
            confidence = (
                row.quality_tier
                * freshness
                * statuses[row.validation_status]
            )
            weighted_confidence += row.configured_weight * confidence

        result = weighted_confidence / total_weight * Decimal("100")
        bounded = max(Decimal("0"), min(Decimal("100"), result))
        return bounded.quantize(_TWO_PLACES)


def latest_revision_as_of(
    rows: Sequence[RevisionedValue], *, as_of: datetime
) -> RevisionedValue | None:
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware.")
    eligible = tuple(row for row in rows if row.observed_at <= as_of)
    if not eligible:
        return None
    return max(eligible, key=lambda row: (row.observed_at, row.revision))
