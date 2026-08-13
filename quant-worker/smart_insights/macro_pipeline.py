from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import re
from typing import Any, Protocol

from smart_insights.collectors.cryptocraft import CalendarEventInput
from smart_insights.macro_registry import classify_surprise_event
from smart_insights.metrics.common import (
    ConfidenceInput,
    InsufficientCoverageError,
    data_confidence,
    empirical_percentile,
    signed_percentile_score,
    weighted_score,
)
from smart_insights.metrics.crypto import (
    MetricDefinitionInput,
    ObservationPoint,
    SignalSnapshotInput,
    SnapshotMetricInput,
)
from smart_insights.metrics.macro import (
    COMPONENT_WEIGHTS,
    MACRO_METRIC_DEFINITIONS,
    METRIC_DEFINITIONS_BY_CODE,
    METHODOLOGY_VERSION,
    event_risk_score,
    market_event_risk,
    parse_release_number,
    release_surprise,
    surprise_z_score,
)
from smart_insights.signals import MetricSignalInput, SignalCandidate, detect_signals
from smart_insights.sources import source_for_code


class MacroRepository(Protocol):
    def upsert_metric_definitions(
        self, definitions: tuple[MetricDefinitionInput, ...]
    ) -> None: ...

    def metric_observations(
        self, metric_code: str, *, as_of: datetime, limit: int = 5_000
    ) -> tuple[ObservationPoint, ...]: ...

    def latest_calendar_events(
        self, *, as_of: datetime, source_code: str = "cryptocraft"
    ) -> tuple[CalendarEventInput, ...]: ...

    def latest_signal_snapshot(
        self, *, market: str, as_of: datetime
    ) -> Mapping[str, Any] | None: ...

    def publish_signal_snapshot(
        self, snapshot: SignalSnapshotInput
    ) -> tuple[str, str]: ...


@dataclass(frozen=True, slots=True)
class MacroPipelineResult:
    regime_snapshot_id: str
    regime_status: str
    event_risk_snapshot_id: str
    event_risk_status: str
    regime_snapshot: SignalSnapshotInput
    event_risk_snapshot: SignalSnapshotInput
    candidates: tuple[SignalCandidate, ...]


@dataclass(frozen=True, slots=True)
class _SeriesPoint:
    value: Decimal
    effective_at: datetime
    observed_at: datetime
    source_ids: tuple[str, ...]
    quality_tier: Decimal
    validation_status: str
    score_override: Decimal | None = None


def _aware(value: datetime, name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware.")


def _quality_tier(provider_code: str) -> Decimal:
    return source_for_code(provider_code).quality_tier


def _point(value: Decimal, rows: Sequence[ObservationPoint]) -> _SeriesPoint:
    return _SeriesPoint(
        value=value,
        effective_at=max(row.effective_at for row in rows),
        observed_at=max(row.observed_at for row in rows),
        source_ids=tuple(sorted({row.id for row in rows})),
        quality_tier=min(_quality_tier(row.provider_code) for row in rows),
        validation_status=(
            "warning" if any(row.quality_status == "warning" for row in rows) else "passed"
        ),
    )


def _raw_series(
    repository: MacroRepository, metric_code: str, *, as_of: datetime
) -> tuple[_SeriesPoint, ...]:
    rows = sorted(
        repository.metric_observations(metric_code, as_of=as_of),
        key=lambda row: (row.effective_at, row.id),
    )
    return tuple(_point(row.value, (row,)) for row in rows)


def _change_4w(rows: Sequence[_SeriesPoint]) -> tuple[_SeriesPoint, ...]:
    output: list[_SeriesPoint] = []
    for current_index, current in enumerate(rows):
        cutoff = current.effective_at - timedelta(days=28)
        eligible = tuple(row for row in rows[:current_index] if row.effective_at <= cutoff)
        if not eligible:
            continue
        previous = eligible[-1]
        output.append(
            _SeriesPoint(
                value=current.value - previous.value,
                effective_at=current.effective_at,
                observed_at=max(current.observed_at, previous.observed_at),
                source_ids=tuple(sorted(set(current.source_ids + previous.source_ids))),
                quality_tier=min(current.quality_tier, previous.quality_tier),
                validation_status=(
                    "warning"
                    if "warning" in {current.validation_status, previous.validation_status}
                    else "passed"
                ),
            )
        )
    return tuple(output)


_UNIT = re.compile(r"([KMBT])?%?$", re.I)


def _unit_signature(value: str) -> str:
    match = _UNIT.search("".join(value.split()))
    return match.group(0).upper() if match else ""


def _surprise_series(
    repository: MacroRepository, category: str, *, as_of: datetime
) -> tuple[_SeriesPoint, ...]:
    grouped: dict[str, list[tuple[CalendarEventInput, int, Decimal]]] = {}
    for event in repository.latest_calendar_events(as_of=as_of):
        if (
            event.event_at_utc is None
            or event.event_at_utc > as_of
            or event.actual is None
            or event.forecast is None
        ):
            continue
        definition = classify_surprise_event(event.country, event.currency, event.name)
        if definition is None or definition.category != category:
            continue
        if _unit_signature(event.actual) != _unit_signature(event.forecast):
            continue
        try:
            surprise = release_surprise(
                parse_release_number(event.actual), parse_release_number(event.forecast)
            )
        except ValueError:
            continue
        grouped.setdefault(definition.series_key, []).append(
            (event, definition.direction, surprise)
        )

    output: list[_SeriesPoint] = []
    for rows in grouped.values():
        ordered = sorted(rows, key=lambda item: (item[0].event_at_utc, item[0].source_event_key))
        history: list[Decimal] = []
        for event, direction, current in ordered:
            z_score = surprise_z_score(current, prior_surprises=tuple(history))
            history.append(current)
            if z_score is None or event.event_at_utc is None:
                continue
            directional = max(
                Decimal("-100"),
                min(Decimal("100"), z_score * Decimal(direction) / Decimal("3") * Decimal("100")),
            ).quantize(Decimal("0.000001"))
            observed_at = event.observed_at or event.event_at_utc
            output.append(
                _SeriesPoint(
                    value=z_score,
                    effective_at=event.event_at_utc,
                    observed_at=observed_at,
                    source_ids=(event.id or event.source_event_key,),
                    quality_tier=source_for_code("cryptocraft").quality_tier,
                    validation_status=event.quality_status,
                    score_override=directional,
                )
            )
    return tuple(sorted(output, key=lambda row: (row.effective_at, row.source_ids)))


def _component_series(
    repository: MacroRepository, code: str, *, as_of: datetime
) -> tuple[_SeriesPoint, ...]:
    changes = {
        "macro.fed_balance_sheet_change_4w": "macro.fed_balance_sheet_musd",
        "macro.reverse_repo_change_4w": "macro.reverse_repo_busd",
        "macro.tga_change_4w": "macro.tga_busd",
    }
    if code in changes:
        return _change_4w(_raw_series(repository, changes[code], as_of=as_of))
    if code == "macro.growth_surprise":
        return _surprise_series(repository, "growth", as_of=as_of)
    if code == "macro.inflation_surprise":
        return _surprise_series(repository, "inflation", as_of=as_of)
    return _raw_series(repository, code, as_of=as_of)


def _snapshot_input(
    code: str, series: Sequence[_SeriesPoint], *, as_of: datetime
) -> SnapshotMetricInput | None:
    if not series:
        return None
    definition = METRIC_DEFINITIONS_BY_CODE[code]
    history_limit = 156 if definition.frequency == "weekly" else 365
    minimum = 26 if definition.frequency == "weekly" else 60
    history = tuple(series[-history_limit:])
    current = history[-1]
    age_minutes = Decimal(str((as_of - current.observed_at).total_seconds() / 60))
    if age_minutes < 0:
        raise ValueError("Macro metric observation must not come from the future.")
    is_fresh = age_minutes <= Decimal(definition.freshness_sla_minutes)
    percentile: Decimal | None = None
    if current.score_override is not None:
        score = current.score_override if is_fresh else None
    else:
        percentile = (
            empirical_percentile(tuple(row.value for row in history), current.value)
            if len(history) >= minimum
            else None
        )
        score = (
            signed_percentile_score(percentile, definition.direction)
            if percentile is not None and is_fresh
            else None
        )
    return SnapshotMetricInput(
        metric_code=code,
        value=current.value,
        score=score,
        percentile=percentile,
        configured_weight=COMPONENT_WEIGHTS[code],
        effective_at=current.effective_at,
        observed_at=current.observed_at,
        source_observation_ids=current.source_ids,
        quality_tier=current.quality_tier,
        validation_status=current.validation_status,
        is_fresh=is_fresh,
    )


def _label(score: Decimal) -> str:
    if score >= 50:
        return "risk_on"
    if score >= 15:
        return "constructive"
    if score > -15:
        return "neutral"
    if score > -50:
        return "defensive"
    return "risk_off"


def _idempotency(
    *, signal_type: str, as_of: datetime, score: Decimal | None, label: str,
    status: str, inputs: Sequence[SnapshotMetricInput]
) -> str:
    payload = {
        "effectiveAt": as_of.isoformat(timespec="microseconds"),
        "inputs": [
            {"code": row.metric_code, "sourceIds": row.source_observation_ids}
            for row in inputs
        ],
        "label": label,
        "market": "macro",
        "methodologyVersion": METHODOLOGY_VERSION,
        "score": None if score is None else format(score, "f"),
        "signalType": signal_type,
        "status": status,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def calculate_macro_snapshot(
    repository: MacroRepository, *, as_of: datetime
) -> SignalSnapshotInput:
    _aware(as_of, "as_of")
    repository.upsert_metric_definitions(MACRO_METRIC_DEFINITIONS)
    inputs = tuple(
        row
        for code in COMPONENT_WEIGHTS
        if (row := _snapshot_input(code, _component_series(repository, code, as_of=as_of), as_of=as_of))
        is not None
    )
    scores = {code: None for code in COMPONENT_WEIGHTS}
    for row in inputs:
        scores[row.metric_code] = row.score
    valid_weight = sum(
        (COMPONENT_WEIGHTS[code] for code, score in scores.items() if score is not None),
        Decimal("0"),
    )
    total_weight = sum(COMPONENT_WEIGHTS.values(), Decimal("0"))
    coverage = (valid_weight / total_weight).quantize(Decimal("0.0001"))
    try:
        score = weighted_score(scores, COMPONENT_WEIGHTS).quantize(Decimal("0.0001"))
    except InsufficientCoverageError:
        score = None
    status = "active" if score is not None else "unavailable"
    label = _label(score) if score is not None else "unavailable"
    by_code = {row.metric_code: row for row in inputs}
    confidence_inputs: dict[str, ConfidenceInput] = {}
    for code, weight in COMPONENT_WEIGHTS.items():
        definition = METRIC_DEFINITIONS_BY_CODE[code]
        row = by_code.get(code)
        confidence_inputs[code] = ConfidenceInput(
            configured_weight=weight,
            quality_tier=row.quality_tier if row else Decimal("1"),
            age_minutes=(
                Decimal(str((as_of - row.observed_at).total_seconds() / 60))
                if row
                else Decimal(definition.freshness_sla_minutes + 1)
            ),
            freshness_sla_minutes=Decimal(definition.freshness_sla_minutes),
            validation_status=row.validation_status if row else "passed",
        )
    confidence = data_confidence(confidence_inputs)
    return SignalSnapshotInput(
        market="macro",
        asset_symbol=None,
        effective_at=as_of,
        methodology_version=METHODOLOGY_VERSION,
        signal_type="regime",
        score=score,
        label=label,
        data_confidence=confidence,
        coverage=coverage,
        inputs=inputs,
        status=status,
        idempotency_key=_idempotency(
            signal_type="regime", as_of=as_of, score=score, label=label,
            status=status, inputs=inputs
        ),
    )


def calculate_event_risk_snapshot(
    repository: MacroRepository,
    *,
    as_of: datetime,
    portfolio_sensitivity: Decimal = Decimal("1"),
) -> SignalSnapshotInput:
    _aware(as_of, "as_of")
    events = repository.latest_calendar_events(as_of=as_of)
    timed = tuple(
        event
        for event in events
        if event.event_at_utc is not None and event.event_at_utc >= as_of
    )
    scored = tuple(
        (
            event_risk_score(
                impact=event.impact,
                event_at=event.event_at_utc,
                now=as_of,
                portfolio_sensitivity=portfolio_sensitivity,
            ),
            event,
        )
        for event in timed
        if event.event_at_utc is not None
    )
    risk = market_event_risk(tuple(row[0] for row in scored))
    winner = max(scored, key=lambda row: (row[0], row[1].source_event_key))[1] if scored else None
    latest_observed = max(
        (event.observed_at for event in events if event.observed_at is not None),
        default=None,
    )
    is_fresh = latest_observed is not None and (
        as_of - latest_observed <= timedelta(minutes=120)
    )
    if winner is not None:
        inputs = (
            SnapshotMetricInput(
                metric_code="macro.event_risk",
                value=risk,
                score=risk,
                percentile=None,
                configured_weight=Decimal("1"),
                effective_at=winner.event_at_utc or as_of,
                observed_at=winner.observed_at or latest_observed or as_of,
                source_observation_ids=(winner.id or winner.source_event_key,),
                quality_tier=source_for_code("cryptocraft").quality_tier,
                validation_status=winner.quality_status,
                is_fresh=is_fresh,
            ),
        )
    else:
        inputs = ()
    status = "active" if events and is_fresh else "unavailable"
    score = risk.quantize(Decimal("0.0001")) if status == "active" else None
    label = (
        "high" if risk >= 75 else "elevated" if risk >= 40 else "watch" if risk > 0 else "low"
    ) if status == "active" else "unavailable"
    confidence = (
        (source_for_code("cryptocraft").quality_tier * Decimal("100")).quantize(Decimal("0.01"))
        if status == "active"
        else Decimal("0.00")
    )
    coverage = Decimal("1.0000") if status == "active" else Decimal("0.0000")
    return SignalSnapshotInput(
        market="macro",
        asset_symbol=None,
        effective_at=as_of,
        methodology_version=METHODOLOGY_VERSION,
        signal_type="event_risk",
        score=score,
        label=label,
        data_confidence=confidence,
        coverage=coverage,
        inputs=inputs,
        status=status,
        idempotency_key=_idempotency(
            signal_type="event_risk", as_of=as_of, score=score, label=label,
            status=status, inputs=inputs
        ),
    )


def _previous_signal(row: Mapping[str, Any] | None) -> MetricSignalInput | None:
    if row is None or row.get("score") is None or not isinstance(row.get("effective_at"), datetime):
        return None
    return MetricSignalInput(
        metric_code="macro.regime.score",
        market="macro",
        asset_symbol=None,
        effective_at=row["effective_at"],
        value=Decimal(str(row["score"])),
        regime_label=str(row.get("label") or "unavailable"),
        is_fresh=row.get("status") == "active",
        score_visible=row.get("status") == "active",
        methodology_version=METHODOLOGY_VERSION,
    )


def run_macro_pipeline(
    repository: MacroRepository, *, as_of: datetime
) -> MacroPipelineResult:
    previous = repository.latest_signal_snapshot(market="macro", as_of=as_of)
    regime = calculate_macro_snapshot(repository, as_of=as_of)
    regime_id, regime_status = repository.publish_signal_snapshot(regime)
    event_risk = calculate_event_risk_snapshot(repository, as_of=as_of)
    event_id, event_status = repository.publish_signal_snapshot(event_risk)
    candidates: tuple[SignalCandidate, ...] = ()
    if regime.score is not None:
        current = MetricSignalInput(
            metric_code="macro.regime.score",
            market="macro",
            asset_symbol=None,
            effective_at=as_of,
            value=regime.score,
            regime_label=regime.label,
            is_fresh=True,
            score_visible=True,
            methodology_version=METHODOLOGY_VERSION,
        )
        candidates = detect_signals(current, _previous_signal(previous))
        for candidate in candidates:
            repository.publish_signal_snapshot(
                SignalSnapshotInput(
                    market="macro",
                    asset_symbol=None,
                    effective_at=as_of,
                    methodology_version=METHODOLOGY_VERSION,
                    signal_type=candidate.kind,
                    score=regime.score,
                    label=candidate.kind,
                    data_confidence=regime.data_confidence,
                    coverage=regime.coverage,
                    inputs=regime.inputs,
                    status="active",
                    idempotency_key=candidate.idempotency_key,
                )
            )
    return MacroPipelineResult(
        regime_id,
        regime_status,
        event_id,
        event_status,
        regime,
        event_risk,
        candidates,
    )
