from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
import hashlib
import json
from typing import Any, Protocol

from smart_insights.gold_registry import GOLD_GROUP_WEIGHTS
from smart_insights.metrics.common import (
    ConfidenceInput,
    InsufficientCoverageError,
    data_confidence,
    empirical_percentile,
    signed_percentile_score,
    simple_return,
)
from smart_insights.metrics.crypto import (
    MarketClose,
    MetricDefinitionInput,
    ObservationPoint,
    SignalSnapshotInput,
    SnapshotMetricInput,
)
from smart_insights.metrics.gold import (
    GOLD_METRIC_DEFINITIONS,
    METHODOLOGY_VERSION,
    GoldRegimeInput,
    gold_regime,
)
from smart_insights.signals import MetricSignalInput, SignalCandidate, detect_signals
from smart_insights.sources import source_for_code


class GoldRepository(Protocol):
    def upsert_metric_definitions(
        self, definitions: tuple[MetricDefinitionInput, ...]
    ) -> None: ...

    def price_closes(
        self, asset_symbol: str, *, as_of: datetime, limit: int = 500
    ) -> tuple[MarketClose, ...]: ...

    def metric_observations(
        self, metric_code: str, *, as_of: datetime, limit: int = 5_000
    ) -> tuple[ObservationPoint, ...]: ...

    def latest_signal_snapshot(
        self, *, market: str, as_of: datetime
    ) -> Mapping[str, Any] | None: ...

    def publish_signal_snapshot(
        self, snapshot: SignalSnapshotInput
    ) -> tuple[str, str]: ...


@dataclass(frozen=True, slots=True)
class GoldPipelineResult:
    snapshot_id: str
    status: str
    snapshot: SignalSnapshotInput
    candidates: tuple[SignalCandidate, ...]


@dataclass(frozen=True, slots=True)
class _SeriesPoint:
    value: Decimal
    effective_at: datetime
    observed_at: datetime
    source_ids: tuple[str, ...]
    quality_tier: Decimal
    validation_status: str


@dataclass(frozen=True, slots=True)
class _GroupPoint:
    name: str
    score: Decimal
    value: Decimal
    effective_at: datetime
    observed_at: datetime
    source_ids: tuple[str, ...]
    quality_tier: Decimal
    validation_status: str
    confidence: Decimal


def _aware(value: datetime, name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware.")


def _raw_series(
    repository: GoldRepository, metric_code: str, *, as_of: datetime
) -> tuple[_SeriesPoint, ...]:
    output: list[_SeriesPoint] = []
    for row in sorted(
        repository.metric_observations(metric_code, as_of=as_of),
        key=lambda item: (item.effective_at, item.observed_at, item.id),
    ):
        if row.effective_at > as_of or row.observed_at > as_of:
            continue
        output.append(
            _SeriesPoint(
                value=row.value,
                effective_at=row.effective_at,
                observed_at=row.observed_at,
                source_ids=(row.id,),
                quality_tier=source_for_code(row.provider_code).quality_tier,
                validation_status=row.quality_status,
            )
        )
    return tuple(output)


def _price_series(
    repository: GoldRepository, *, as_of: datetime, lookback: int
) -> tuple[_SeriesPoint, ...]:
    closes = tuple(
        row
        for row in sorted(repository.price_closes("XAU", as_of=as_of), key=lambda row: row.ts)
        if row.ts <= as_of and row.observed_at <= as_of
    )
    output: list[_SeriesPoint] = []
    for index in range(lookback, len(closes)):
        previous, current = closes[index - lookback], closes[index]
        output.append(
            _SeriesPoint(
                value=simple_return(previous.close, current.close),
                effective_at=current.ts,
                observed_at=max(previous.observed_at, current.observed_at),
                source_ids=(previous.id, current.id),
                quality_tier=Decimal("1"),
                validation_status="passed",
            )
        )
    return tuple(output)


def _change_series(
    rows: Sequence[_SeriesPoint], lookback: int
) -> tuple[_SeriesPoint, ...]:
    output: list[_SeriesPoint] = []
    for index in range(lookback, len(rows)):
        previous, current = rows[index - lookback], rows[index]
        if previous.value == 0:
            continue
        output.append(
            _SeriesPoint(
                value=simple_return(previous.value, current.value),
                effective_at=current.effective_at,
                observed_at=max(previous.observed_at, current.observed_at),
                source_ids=tuple(sorted(set(previous.source_ids + current.source_ids))),
                quality_tier=min(previous.quality_tier, current.quality_tier),
                validation_status=(
                    "warning"
                    if "warning" in {previous.validation_status, current.validation_status}
                    else "passed"
                ),
            )
        )
    return tuple(output)


def _scored_component(
    rows: Sequence[_SeriesPoint], *, direction: int, minimum: int, as_of: datetime,
    freshness_sla_minutes: int
) -> tuple[_SeriesPoint, Decimal, Decimal] | None:
    history = tuple(rows[-365:])
    if len(history) < minimum:
        return None
    current = history[-1]
    age = Decimal(str((as_of - current.observed_at).total_seconds() / 60))
    if age < 0 or age > Decimal(freshness_sla_minutes):
        return None
    percentile = empirical_percentile(tuple(row.value for row in history), current.value)
    return current, signed_percentile_score(percentile, direction), percentile


def _group(
    name: str,
    components: Sequence[tuple[_SeriesPoint, Decimal, Decimal]],
    *,
    as_of: datetime,
    freshness_sla_minutes: int,
) -> _GroupPoint | None:
    if not components:
        return None
    score = (sum((row[1] for row in components), Decimal("0")) / Decimal(len(components))).quantize(Decimal("0.000001"))
    current_rows = tuple(row[0] for row in components)
    confidence = data_confidence(
        {
            str(index): ConfidenceInput(
                configured_weight=Decimal("1"),
                quality_tier=row.quality_tier,
                age_minutes=Decimal(str((as_of - row.observed_at).total_seconds() / 60)),
                freshness_sla_minutes=Decimal(freshness_sla_minutes),
                validation_status=row.validation_status,
            )
            for index, row in enumerate(current_rows)
        }
    )
    return _GroupPoint(
        name=name,
        score=score,
        value=sum((row.value for row in current_rows), Decimal("0")) / Decimal(len(current_rows)),
        effective_at=max(row.effective_at for row in current_rows),
        observed_at=max(row.observed_at for row in current_rows),
        source_ids=tuple(sorted({source_id for row in current_rows for source_id in row.source_ids})),
        quality_tier=min(row.quality_tier for row in current_rows),
        validation_status=("warning" if any(row.validation_status == "warning" for row in current_rows) else "passed"),
        confidence=confidence,
    )


def _groups(repository: GoldRepository, *, as_of: datetime) -> tuple[_GroupPoint, ...]:
    one_day = _scored_component(_price_series(repository, as_of=as_of, lookback=1), direction=1, minimum=60, as_of=as_of, freshness_sla_minutes=4_320)
    momentum = _scored_component(_price_series(repository, as_of=as_of, lookback=20), direction=1, minimum=60, as_of=as_of, freshness_sla_minutes=4_320)
    real_yield = _scored_component(_raw_series(repository, "macro.real_yield.10y_pct", as_of=as_of), direction=-1, minimum=60, as_of=as_of, freshness_sla_minutes=4_320)
    usd = _scored_component(_change_series(_raw_series(repository, "macro.usd_broad_index", as_of=as_of), 20), direction=-1, minimum=60, as_of=as_of, freshness_sla_minutes=4_320)
    cftc = _scored_component(_raw_series(repository, "gold.cftc.managed_money_net_oi", as_of=as_of), direction=1, minimum=26, as_of=as_of, freshness_sla_minutes=14_400)
    specifications = (
        ("momentum", tuple(row for row in (one_day, momentum) if row), 4_320),
        ("real_yields", tuple(row for row in (real_yield,) if row), 4_320),
        ("usd_pressure", tuple(row for row in (usd,) if row), 4_320),
        ("cftc_positioning", tuple(row for row in (cftc,) if row), 14_400),
    )
    return tuple(
        result
        for name, rows, sla in specifications
        if (result := _group(name, rows, as_of=as_of, freshness_sla_minutes=sla)) is not None
    )


def _idempotency(snapshot: SignalSnapshotInput) -> str:
    payload = {
        "effectiveAt": snapshot.effective_at.isoformat(timespec="microseconds"),
        "inputs": [
            {"code": row.metric_code, "sourceIds": row.source_observation_ids}
            for row in snapshot.inputs
        ],
        "label": snapshot.label,
        "market": snapshot.market,
        "methodologyVersion": snapshot.methodology_version,
        "score": None if snapshot.score is None else format(snapshot.score, "f"),
        "signalType": snapshot.signal_type,
        "status": snapshot.status,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def calculate_gold_snapshot(
    repository: GoldRepository, *, as_of: datetime
) -> SignalSnapshotInput:
    _aware(as_of, "as_of")
    repository.upsert_metric_definitions(GOLD_METRIC_DEFINITIONS)
    groups = _groups(repository, as_of=as_of)
    inputs = tuple(
        SnapshotMetricInput(
            metric_code=f"gold.group.{row.name}",
            value=row.value,
            score=row.score,
            percentile=None,
            configured_weight=GOLD_GROUP_WEIGHTS[row.name],
            effective_at=row.effective_at,
            observed_at=row.observed_at,
            source_observation_ids=row.source_ids,
            quality_tier=row.quality_tier,
            validation_status=row.validation_status,
            is_fresh=True,
        )
        for row in groups
    )
    regime_inputs = {
        row.name: GoldRegimeInput(row.score, row.confidence, row.source_ids)
        for row in groups
    }
    valid_weight = sum((GOLD_GROUP_WEIGHTS[row.name] for row in groups), Decimal("0"))
    total_weight = sum(GOLD_GROUP_WEIGHTS.values(), Decimal("0"))
    coverage = (valid_weight / total_weight).quantize(Decimal("0.0001"))
    try:
        regime = gold_regime(regime_inputs)
    except InsufficientCoverageError:
        regime = None
    provisional = SignalSnapshotInput(
        market="gold",
        asset_symbol="XAU",
        effective_at=as_of,
        methodology_version=METHODOLOGY_VERSION,
        signal_type="regime",
        score=regime.score if regime else None,
        label=regime.label if regime else "unavailable",
        data_confidence=regime.data_confidence if regime else Decimal("0.00"),
        coverage=coverage,
        inputs=inputs,
        status="active" if regime else "unavailable",
        idempotency_key="pending",
    )
    return SignalSnapshotInput(
        market=provisional.market,
        asset_symbol=provisional.asset_symbol,
        effective_at=provisional.effective_at,
        methodology_version=provisional.methodology_version,
        signal_type=provisional.signal_type,
        score=provisional.score,
        label=provisional.label,
        data_confidence=provisional.data_confidence,
        coverage=provisional.coverage,
        inputs=provisional.inputs,
        status=provisional.status,
        idempotency_key=_idempotency(provisional),
    )


def _previous_signal(row: Mapping[str, Any] | None) -> MetricSignalInput | None:
    if row is None or row.get("score") is None or not isinstance(row.get("effective_at"), datetime):
        return None
    return MetricSignalInput(
        metric_code="gold.regime.score",
        market="gold",
        asset_symbol="XAU",
        effective_at=row["effective_at"],
        value=Decimal(str(row["score"])),
        regime_label=str(row.get("label") or "unavailable"),
        is_fresh=row.get("status") == "active",
        score_visible=row.get("status") == "active",
        methodology_version=METHODOLOGY_VERSION,
    )


def run_gold_pipeline(
    repository: GoldRepository, *, as_of: datetime
) -> GoldPipelineResult:
    previous = repository.latest_signal_snapshot(market="gold", as_of=as_of)
    snapshot = calculate_gold_snapshot(repository, as_of=as_of)
    snapshot_id, status = repository.publish_signal_snapshot(snapshot)
    candidates: tuple[SignalCandidate, ...] = ()
    if snapshot.score is not None:
        current = MetricSignalInput(
            metric_code="gold.regime.score",
            market="gold",
            asset_symbol="XAU",
            effective_at=as_of,
            value=snapshot.score,
            regime_label=snapshot.label,
            is_fresh=True,
            score_visible=True,
            methodology_version=METHODOLOGY_VERSION,
        )
        candidates = detect_signals(current, _previous_signal(previous))
        for candidate in candidates:
            repository.publish_signal_snapshot(
                SignalSnapshotInput(
                    market="gold",
                    asset_symbol="XAU",
                    effective_at=as_of,
                    methodology_version=METHODOLOGY_VERSION,
                    signal_type=candidate.kind,
                    score=snapshot.score,
                    label=candidate.kind,
                    data_confidence=snapshot.data_confidence,
                    coverage=snapshot.coverage,
                    inputs=snapshot.inputs,
                    status="active",
                    idempotency_key=candidate.idempotency_key,
                )
            )
    return GoldPipelineResult(snapshot_id, status, snapshot, candidates)
