from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
import hashlib
import json
from statistics import median
from typing import Protocol

from smart_insights.metrics.crypto import (
    CRYPTO_METRIC_DEFINITIONS,
    ObservationPoint,
    SignalSnapshotInput,
    SnapshotMetricInput,
)


METHODOLOGY_VERSION = "btc-large-address-action-v1"
COMPONENT_WEIGHTS = {
    "crypto.large_address.net_accumulation_btc": Decimal("0.35"),
    "crypto.large_address.exchange_flow_pressure_btc": Decimal("0.30"),
    "crypto.large_address.accumulation_breadth": Decimal("0.20"),
    "crypto.large_address.dormant_from_exchange_btc": Decimal("0.15"),
}


class LargeAddressRepository(Protocol):
    def upsert_metric_definitions(self, definitions: tuple[object, ...]) -> None: ...

    def metric_observations(
        self, metric_code: str, *, as_of: datetime, limit: int = 5_000
    ) -> tuple[ObservationPoint, ...]: ...


@dataclass(frozen=True, slots=True)
class CommonCohortMetrics:
    net_accumulation_btc: Decimal
    accumulation_breadth: Decimal
    distribution_breadth: Decimal
    accumulating_count: int
    distributing_count: int
    unchanged_count: int
    entrant_count: int
    exit_count: int
    entrant_balance_btc: Decimal
    exit_balance_btc: Decimal


@dataclass(frozen=True, slots=True)
class _DailyComponents:
    effective_at: datetime
    observed_at: datetime
    accumulation: Decimal
    exchange: Decimal
    breadth: Decimal
    dormant: Decimal
    source_ids: tuple[str, ...]


def common_cohort_metrics(
    *, previous: Mapping[str, Decimal], current: Mapping[str, Decimal]
) -> CommonCohortMetrics:
    common = set(previous) & set(current)
    entrants = set(current) - set(previous)
    exits = set(previous) - set(current)
    accumulation = 0
    distribution = 0
    unchanged = 0
    net = Decimal("0")
    for address in common:
        change = current[address] - previous[address]
        net += change
        threshold = max(Decimal("10"), abs(previous[address]) * Decimal("0.001"))
        if change > threshold:
            accumulation += 1
        elif change < -threshold:
            distribution += 1
        else:
            unchanged += 1
    denominator = Decimal(len(common))
    accumulation_breadth = (
        Decimal(accumulation) / denominator if denominator else Decimal("0")
    ).quantize(Decimal("0.000001"))
    distribution_breadth = (
        Decimal(distribution) / denominator if denominator else Decimal("0")
    ).quantize(Decimal("0.000001"))
    return CommonCohortMetrics(
        net_accumulation_btc=net,
        accumulation_breadth=accumulation_breadth,
        distribution_breadth=distribution_breadth,
        accumulating_count=accumulation,
        distributing_count=distribution,
        unchanged_count=unchanged,
        entrant_count=len(entrants),
        exit_count=len(exits),
        entrant_balance_btc=sum((current[key] for key in entrants), Decimal("0")),
        exit_balance_btc=sum((previous[key] for key in exits), Decimal("0")),
    )


def _latest_by_time(rows: Sequence[ObservationPoint]) -> dict[datetime, ObservationPoint]:
    result: dict[datetime, ObservationPoint] = {}
    for row in rows:
        current = result.get(row.effective_at)
        if current is None or (row.revision, row.observed_at, row.id) > (
            current.revision,
            current.observed_at,
            current.id,
        ):
            result[row.effective_at] = row
    return result


def _balance_days(
    rows: Sequence[ObservationPoint],
) -> tuple[tuple[datetime, datetime, dict[str, Decimal], tuple[str, ...]], ...]:
    grouped: dict[datetime, list[ObservationPoint]] = {}
    for row in rows:
        address = row.dimensions.get("address")
        if address:
            grouped.setdefault(row.effective_at, []).append(row)
    result = []
    for effective_at in sorted(grouped):
        period = grouped[effective_at]
        result.append(
            (
                effective_at,
                max(row.observed_at for row in period),
                {row.dimensions["address"]: row.value for row in period},
                tuple(sorted(row.id for row in period)),
            )
        )
    return tuple(result)


def _daily_components(
    repository: LargeAddressRepository, *, as_of: datetime
) -> tuple[_DailyComponents, ...]:
    balance_days = _balance_days(
        repository.metric_observations(
            "crypto.large_address.confirmed_balance_btc", as_of=as_of
        )
    )
    to_exchange = _latest_by_time(
        repository.metric_observations(
            "crypto.large_address.to_exchange_btc", as_of=as_of
        )
    )
    from_exchange = _latest_by_time(
        repository.metric_observations(
            "crypto.large_address.from_exchange_btc", as_of=as_of
        )
    )
    dormant_to = _latest_by_time(
        repository.metric_observations(
            "crypto.large_address.dormant_to_exchange_btc", as_of=as_of
        )
    )
    dormant_from = _latest_by_time(
        repository.metric_observations(
            "crypto.large_address.dormant_from_exchange_btc", as_of=as_of
        )
    )
    result: list[_DailyComponents] = []
    for index in range(1, len(balance_days)):
        effective_at, observed_at, current, current_ids = balance_days[index]
        _, previous_observed_at, previous, previous_ids = balance_days[index - 1]
        cohort = common_cohort_metrics(previous=previous, current=current)
        to_row = to_exchange.get(effective_at)
        from_row = from_exchange.get(effective_at)
        dormant_to_row = dormant_to.get(effective_at)
        dormant_from_row = dormant_from.get(effective_at)
        source_rows = tuple(
            row
            for row in (to_row, from_row, dormant_to_row, dormant_from_row)
            if row is not None
        )
        result.append(
            _DailyComponents(
                effective_at=effective_at,
                observed_at=max(
                    (observed_at, previous_observed_at, *(row.observed_at for row in source_rows))
                ),
                accumulation=cohort.net_accumulation_btc,
                exchange=(from_row.value if from_row else Decimal("0"))
                - (to_row.value if to_row else Decimal("0")),
                breadth=cohort.accumulation_breadth - cohort.distribution_breadth,
                dormant=(dormant_from_row.value if dormant_from_row else Decimal("0"))
                - (dormant_to_row.value if dormant_to_row else Decimal("0")),
                source_ids=tuple(
                    sorted(
                        {
                            *current_ids,
                            *previous_ids,
                            *(row.id for row in source_rows),
                        }
                    )
                ),
            )
        )
    return tuple(result)


def _mean(values: Sequence[Decimal]) -> Decimal:
    return sum(values, Decimal("0")) / Decimal(len(values))


def _standard_deviation(values: Sequence[Decimal]) -> Decimal:
    average = _mean(values)
    variance = sum(((value - average) ** 2 for value in values), Decimal("0")) / Decimal(
        len(values)
    )
    return variance.sqrt()


def _robust_component(values: Sequence[Decimal]) -> Decimal | None:
    if len(values) < 30:
        return None
    history = tuple(values[-90:])
    current = history[-1]
    center = Decimal(median(history))
    deviations = tuple(abs(value - center) for value in history)
    mad = Decimal(median(deviations))
    if mad:
        z_score = (current - center) / (Decimal("1.4826") * mad)
    else:
        deviation = _standard_deviation(history)
        if not deviation:
            return Decimal("0") if current == center else None
        z_score = (current - _mean(history)) / deviation
    bounded = max(Decimal("-3"), min(Decimal("3"), z_score))
    return (bounded / Decimal("3")).quantize(Decimal("0.000001"))


def _latest_value(
    repository: LargeAddressRepository, code: str, *, as_of: datetime
) -> ObservationPoint | None:
    rows = repository.metric_observations(code, as_of=as_of)
    return max(rows, key=lambda row: (row.effective_at, row.revision, row.observed_at), default=None)


def _confidence(repository: LargeAddressRepository, *, as_of: datetime) -> tuple[Decimal, Decimal]:
    coverage_rows = tuple(
        _latest_value(repository, code, as_of=as_of)
        for code in (
            "crypto.large_address.address_coverage",
            "crypto.large_address.transaction_coverage",
            "crypto.large_address.flow_label_coverage",
        )
    )
    address, transaction, labels = (
        row.value if row is not None else Decimal("0") for row in coverage_rows
    )
    universe = _latest_value(
        repository, "crypto.large_address.address_balance_btc", as_of=as_of
    )
    universe_fresh = Decimal("0")
    if universe is not None:
        age_hours = Decimal(str((as_of - universe.observed_at).total_seconds())) / Decimal(
            "3600"
        )
        universe_fresh = Decimal("1") if age_hours <= Decimal("48") else Decimal("0")
    confidence = Decimal("100") * (
        Decimal("0.30") * address
        + Decimal("0.25") * transaction
        + Decimal("0.25") * labels
        + Decimal("0.20") * universe_fresh
    )
    coverage = min(address, transaction, labels, universe_fresh)
    return confidence.quantize(Decimal("0.01")), coverage.quantize(Decimal("0.0001"))


def _label(score: Decimal) -> str:
    if score >= Decimal("30"):
        return "accumulation"
    if score <= Decimal("-30"):
        return "distribution"
    return "neutral"


def calculate_large_address_snapshot(
    repository: LargeAddressRepository, *, as_of: datetime
) -> SignalSnapshotInput:
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware.")
    repository.upsert_metric_definitions(CRYPTO_METRIC_DEFINITIONS)
    days = _daily_components(repository, as_of=as_of)
    confidence, coverage = _confidence(repository, as_of=as_of)
    component_series = {
        "crypto.large_address.net_accumulation_btc": tuple(row.accumulation for row in days),
        "crypto.large_address.exchange_flow_pressure_btc": tuple(row.exchange for row in days),
        "crypto.large_address.accumulation_breadth": tuple(row.breadth for row in days),
        "crypto.large_address.dormant_from_exchange_btc": tuple(row.dormant for row in days),
    }
    component_scores = {
        code: _robust_component(values) for code, values in component_series.items()
    }
    current = days[-1] if days else None
    inputs = tuple(
        SnapshotMetricInput(
            metric_code=code,
            value=values[-1],
            score=(None if component_scores[code] is None else component_scores[code] * Decimal("100")),
            percentile=None,
            configured_weight=COMPONENT_WEIGHTS[code],
            effective_at=current.effective_at,
            observed_at=current.observed_at,
            source_observation_ids=current.source_ids,
            quality_tier=Decimal("0.85"),
            validation_status="passed",
            is_fresh=(as_of - current.observed_at).total_seconds() <= 172_800,
        )
        for code, values in component_series.items()
        if current is not None and values
    )
    eligible = len(days) >= 30 and all(value is not None for value in component_scores.values())
    raw_score = None
    if eligible and confidence >= Decimal("60"):
        raw_score = Decimal("100") * sum(
            (
                COMPONENT_WEIGHTS[code] * value
                for code, value in component_scores.items()
                if value is not None
            ),
            Decimal("0"),
        )
        raw_score = max(Decimal("-100"), min(Decimal("100"), raw_score)).quantize(
            Decimal("0.0001")
        )
    if confidence < Decimal("60"):
        label = "unavailable"
        status = "unavailable"
    elif not eligible:
        label = "calibrating"
        status = "unavailable"
    else:
        label = _label(raw_score or Decimal("0"))
        status = "active"
    effective_at = current.effective_at if current is not None else as_of
    payload = {
        "effectiveAt": effective_at.isoformat(timespec="microseconds"),
        "inputIds": [source_id for row in inputs for source_id in row.source_observation_ids],
        "label": label,
        "methodology": METHODOLOGY_VERSION,
        "score": None if raw_score is None else format(raw_score, "f"),
        "status": status,
    }
    idempotency_key = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return SignalSnapshotInput(
        market="crypto",
        asset_symbol="BTC",
        effective_at=effective_at,
        methodology_version=METHODOLOGY_VERSION,
        signal_type="large_address_action",
        score=raw_score,
        label=label,
        data_confidence=confidence,
        coverage=coverage,
        inputs=inputs,
        status=status,
        idempotency_key=idempotency_key,
    )
