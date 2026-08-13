from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, localcontext
import hashlib
import json
from typing import Any, Protocol

from smart_insights.metrics.common import (
    ConfidenceInput,
    InsufficientCoverageError,
    data_confidence,
    empirical_percentile,
    signed_percentile_score,
    simple_return,
    weighted_score,
)
from smart_insights.metrics.crypto import (
    COMPONENT_WEIGHTS,
    CRYPTO_METRIC_DEFINITIONS,
    METRIC_DEFINITIONS_BY_CODE,
    METHODOLOGY_VERSION,
    MarketClose,
    MetricDefinitionInput,
    ObservationPoint,
    SignalSnapshotInput,
    SnapshotMetricInput,
)
from smart_insights.signals import MetricSignalInput, SignalCandidate, detect_signals
from smart_insights.sources import source_for_code


class CryptoRepository(Protocol):
    def upsert_metric_definitions(
        self, definitions: tuple[MetricDefinitionInput, ...]
    ) -> None: ...

    def metric_observations(
        self, metric_code: str, *, as_of: datetime, limit: int = 5_000
    ) -> tuple[ObservationPoint, ...]: ...

    def price_closes(
        self, asset_symbol: str, *, as_of: datetime, limit: int = 500
    ) -> tuple[MarketClose, ...]: ...

    def latest_signal_snapshot(
        self, *, market: str, as_of: datetime
    ) -> Mapping[str, Any] | None: ...

    def publish_signal_snapshot(
        self, snapshot: SignalSnapshotInput
    ) -> tuple[str, str]: ...


@dataclass(frozen=True, slots=True)
class PipelineResult:
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


def _aware(value: datetime, field_name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware.")


def _quality_tier(provider_code: str) -> Decimal:
    try:
        return source_for_code(provider_code).quality_tier
    except KeyError as error:
        raise ValueError("Observation provider is not registered.") from error


def _validation_status(rows: Sequence[ObservationPoint]) -> str:
    return "warning" if any(row.quality_status == "warning" for row in rows) else "passed"


def _series_point(
    value: Decimal, rows: Sequence[ObservationPoint]
) -> _SeriesPoint:
    if not rows:
        raise ValueError("A derived metric requires source rows.")
    return _SeriesPoint(
        value=value,
        effective_at=max(row.effective_at for row in rows),
        observed_at=max(row.observed_at for row in rows),
        source_ids=tuple(sorted({row.id for row in rows})),
        quality_tier=min(_quality_tier(row.provider_code) for row in rows),
        validation_status=_validation_status(rows),
    )


def _raw_series(
    repository: CryptoRepository,
    metric_code: str,
    *,
    as_of: datetime,
    predicate: Any | None = None,
) -> tuple[_SeriesPoint, ...]:
    rows = repository.metric_observations(metric_code, as_of=as_of)
    if predicate is not None:
        rows = tuple(row for row in rows if predicate(row))
    return tuple(
        _series_point(row.value, (row,))
        for row in sorted(rows, key=lambda item: (item.effective_at, item.id))
    )


def _price_momentum(
    repository: CryptoRepository, asset: str, *, as_of: datetime
) -> tuple[_SeriesPoint, ...]:
    closes = repository.price_closes(asset, as_of=as_of, limit=500)
    ordered = tuple(sorted(closes, key=lambda row: row.ts))
    result: list[_SeriesPoint] = []
    for index in range(20, len(ordered)):
        window = ordered[index - 20 : index + 1]
        value = simple_return(window[0].close, window[-1].close)
        result.append(
            _SeriesPoint(
                value=value,
                effective_at=window[-1].ts,
                observed_at=max(row.observed_at for row in window),
                source_ids=tuple(row.id for row in window),
                quality_tier=Decimal("1"),
                validation_status="passed",
            )
        )
    return tuple(result)


def _change_series(
    rows: Sequence[_SeriesPoint], lookback: int
) -> tuple[_SeriesPoint, ...]:
    result: list[_SeriesPoint] = []
    for index in range(lookback, len(rows)):
        previous = rows[index - lookback]
        current = rows[index]
        if previous.value == 0:
            continue
        result.append(
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
    return tuple(result)


def _etf_series(
    repository: CryptoRepository, *, as_of: datetime
) -> tuple[_SeriesPoint, ...]:
    rows = repository.metric_observations(
        "crypto.etf.net_flow_usd", as_of=as_of
    )
    totals = tuple(
        row
        for row in rows
        if row.dimensions.get("fund") == "TOTAL"
        and row.asset_symbol in {"BTC", "ETH", "SOL"}
    )
    grouped: dict[datetime, list[ObservationPoint]] = {}
    for row in totals:
        grouped.setdefault(row.effective_at, []).append(row)
    daily: list[_SeriesPoint] = []
    for effective_at in sorted(grouped):
        period = grouped[effective_at]
        if {row.asset_symbol for row in period} != {"BTC", "ETH", "SOL"}:
            continue
        daily.append(_series_point(sum((row.value for row in period), Decimal("0")), period))
    result: list[_SeriesPoint] = []
    for index in range(4, len(daily)):
        window = daily[index - 4 : index + 1]
        result.append(
            _SeriesPoint(
                value=sum((row.value for row in window), Decimal("0")),
                effective_at=window[-1].effective_at,
                observed_at=max(row.observed_at for row in window),
                source_ids=tuple(
                    sorted({item for row in window for item in row.source_ids})
                ),
                quality_tier=min(row.quality_tier for row in window),
                validation_status=(
                    "warning"
                    if any(row.validation_status == "warning" for row in window)
                    else "passed"
                ),
            )
        )
    return tuple(result)


def _funding_series(
    repository: CryptoRepository, *, as_of: datetime
) -> tuple[_SeriesPoint, ...]:
    rows = repository.metric_observations(
        "crypto.derivatives.funding_rate", as_of=as_of
    )
    grouped: dict[date, dict[str, ObservationPoint]] = {}
    for row in rows:
        if row.asset_symbol not in {"BTC", "ETH"}:
            continue
        by_asset = grouped.setdefault(row.effective_at.astimezone(timezone.utc).date(), {})
        existing = by_asset.get(row.asset_symbol)
        if existing is None or row.effective_at > existing.effective_at:
            by_asset[row.asset_symbol] = row
    result: list[_SeriesPoint] = []
    for current_date in sorted(grouped):
        period = grouped[current_date]
        if set(period) != {"BTC", "ETH"}:
            continue
        selected = tuple(period[asset] for asset in ("BTC", "ETH"))
        value = sum((abs(row.value) for row in selected), Decimal("0")) / Decimal("2")
        result.append(_series_point(value, selected))
    return tuple(result)


def _component_series(
    repository: CryptoRepository, code: str, *, as_of: datetime
) -> tuple[_SeriesPoint, ...]:
    if code.startswith("price."):
        return _price_momentum(repository, code.split(".")[1].upper(), as_of=as_of)
    if code == "crypto.etf.net_flow_usd_5d":
        return _etf_series(repository, as_of=as_of)
    if code == "crypto.coinshares.net_flow_usd":
        return _raw_series(
            repository,
            code,
            as_of=as_of,
            predicate=lambda row: row.dimensions.get("asset", "").casefold() == "total",
        )
    if code == "crypto.stablecoin.supply_change_7d":
        return _change_series(
            _raw_series(repository, "crypto.stablecoin.supply_usd", as_of=as_of), 7
        )
    if code == "crypto.defi.tvl_change_7d":
        return _change_series(
            _raw_series(
                repository,
                "crypto.defi.chain_tvl_usd",
                as_of=as_of,
                predicate=lambda row: row.dimensions.get("chain") == "TOTAL",
            ),
            7,
        )
    if code == "crypto.onchain.adjusted_transfer_change_30d":
        return _change_series(
            _raw_series(
                repository,
                "crypto.onchain.adjusted_transfer_usd",
                as_of=as_of,
                predicate=lambda row: row.asset_symbol == "BTC",
            ),
            30,
        )
    if code == "crypto.onchain.active_addresses_change_30d":
        return _change_series(
            _raw_series(
                repository,
                "crypto.onchain.active_addresses",
                as_of=as_of,
                predicate=lambda row: row.asset_symbol == "BTC",
            ),
            30,
        )
    if code == "crypto.network.hashrate_change_30d":
        return _change_series(
            _raw_series(
                repository,
                "crypto.network.hashrate_hs",
                as_of=as_of,
                predicate=lambda row: row.asset_symbol == "BTC"
                and row.dimensions.get("frequency") != "instant",
            ),
            30,
        )
    if code == "crypto.onchain.nvt":
        return _raw_series(
            repository,
            code,
            as_of=as_of,
            predicate=lambda row: row.asset_symbol == "BTC",
        )
    if code in {
        "crypto.derivatives.btc_dvol",
        "crypto.derivatives.eth_dvol",
        "crypto.fear_greed.index",
    }:
        return _raw_series(repository, code, as_of=as_of)
    if code == "crypto.derivatives.abs_funding_percentile":
        return _funding_series(repository, as_of=as_of)
    raise ValueError(f"Unknown Crypto component: {code}")


def _snapshot_input(
    code: str,
    series: Sequence[_SeriesPoint],
    *,
    as_of: datetime,
) -> SnapshotMetricInput | None:
    if not series:
        return None
    definition = METRIC_DEFINITIONS_BY_CODE[code]
    frequency = definition.frequency
    weekly = frequency == "weekly"
    window = 156 if weekly else 365
    minimum = 26 if weekly else 60
    history = tuple(series[-window:])
    current = history[-1]
    age_minutes = Decimal(str((as_of - current.observed_at).total_seconds() / 60))
    if age_minutes < 0:
        raise ValueError("Metric effective time must not be in the future.")
    is_fresh = age_minutes <= Decimal(definition.freshness_sla_minutes)
    percentile = (
        empirical_percentile(
            tuple(row.value for row in history), current.value
        )
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
    if score >= Decimal("50"):
        return "risk_on"
    if score >= Decimal("15"):
        return "constructive"
    if score > Decimal("-15"):
        return "neutral"
    if score > Decimal("-50"):
        return "defensive"
    return "risk_off"


def _idempotency_key(
    *,
    effective_at: datetime,
    score: Decimal | None,
    label: str,
    status: str,
    inputs: Sequence[SnapshotMetricInput],
) -> str:
    payload = {
        "effectiveAt": effective_at.isoformat(timespec="microseconds"),
        "inputs": [
            {
                "code": row.metric_code,
                "sourceIds": row.source_observation_ids,
            }
            for row in inputs
        ],
        "label": label,
        "market": "crypto",
        "methodologyVersion": METHODOLOGY_VERSION,
        "score": None if score is None else format(score, "f"),
        "status": status,
    }
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def calculate_crypto_snapshot(
    repository: CryptoRepository, *, as_of: datetime
) -> SignalSnapshotInput:
    _aware(as_of, "as_of")
    repository.upsert_metric_definitions(CRYPTO_METRIC_DEFINITIONS)
    inputs = tuple(
        row
        for code in COMPONENT_WEIGHTS
        if (row := _snapshot_input(
            code, _component_series(repository, code, as_of=as_of), as_of=as_of
        ))
        is not None
    )
    score_values = {code: None for code in COMPONENT_WEIGHTS}
    for row in inputs:
        score_values[row.metric_code] = row.score
    valid_weight = sum(
        (
            COMPONENT_WEIGHTS[code]
            for code, value in score_values.items()
            if value is not None
        ),
        Decimal("0"),
    )
    total_weight = sum(COMPONENT_WEIGHTS.values(), Decimal("0"))
    coverage = (valid_weight / total_weight).quantize(Decimal("0.0001"))
    try:
        score = weighted_score(
            score_values, COMPONENT_WEIGHTS, minimum_coverage=Decimal("0.60")
        ).quantize(Decimal("0.0001"))
    except InsufficientCoverageError:
        score = None
    status = "active" if score is not None else "unavailable"
    label = _label(score) if score is not None else "unavailable"

    confidence_rows: dict[str, ConfidenceInput] = {}
    by_code = {row.metric_code: row for row in inputs}
    for code, weight in COMPONENT_WEIGHTS.items():
        row = by_code.get(code)
        definition = METRIC_DEFINITIONS_BY_CODE[code]
        if row is None:
            confidence_rows[code] = ConfidenceInput(
                configured_weight=weight,
                quality_tier=Decimal("1"),
                age_minutes=Decimal(definition.freshness_sla_minutes + 1),
                freshness_sla_minutes=Decimal(definition.freshness_sla_minutes),
                validation_status="passed",
            )
            continue
        confidence_rows[code] = ConfidenceInput(
            configured_weight=weight,
            quality_tier=row.quality_tier,
            age_minutes=Decimal(
                str((as_of - row.observed_at).total_seconds() / 60)
            ),
            freshness_sla_minutes=Decimal(definition.freshness_sla_minutes),
            validation_status=row.validation_status,
        )
    confidence = data_confidence(confidence_rows)
    return SignalSnapshotInput(
        market="crypto",
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
        idempotency_key=_idempotency_key(
            effective_at=as_of,
            score=score,
            label=label,
            status=status,
            inputs=inputs,
        ),
    )


def _previous_signal(
    row: Mapping[str, Any] | None,
) -> MetricSignalInput | None:
    if row is None or row.get("score") is None:
        return None
    effective_at = row.get("effective_at")
    if not isinstance(effective_at, datetime):
        return None
    return MetricSignalInput(
        metric_code="crypto.regime.score",
        market="crypto",
        asset_symbol=None,
        effective_at=effective_at,
        value=Decimal(str(row["score"])),
        regime_label=str(row.get("label") or "unavailable"),
        is_fresh=row.get("status") == "active",
        score_visible=row.get("status") == "active",
        methodology_version=METHODOLOGY_VERSION,
    )


def run_crypto_pipeline(
    repository: CryptoRepository, *, as_of: datetime
) -> PipelineResult:
    previous = repository.latest_signal_snapshot(market="crypto", as_of=as_of)
    snapshot = calculate_crypto_snapshot(repository, as_of=as_of)
    snapshot_id, status = repository.publish_signal_snapshot(snapshot)
    candidates: tuple[SignalCandidate, ...] = ()
    if snapshot.score is not None:
        current = MetricSignalInput(
            metric_code="crypto.regime.score",
            market="crypto",
            asset_symbol=None,
            effective_at=snapshot.effective_at,
            value=snapshot.score,
            regime_label=snapshot.label,
            is_fresh=snapshot.status == "active",
            score_visible=snapshot.status == "active",
            methodology_version=METHODOLOGY_VERSION,
        )
        candidates = detect_signals(current, _previous_signal(previous))
        for candidate in candidates:
            repository.publish_signal_snapshot(
                SignalSnapshotInput(
                    market="crypto",
                    asset_symbol=None,
                    effective_at=snapshot.effective_at,
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
    return PipelineResult(snapshot_id, status, snapshot, candidates)
