from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
import hashlib
import json
from collections.abc import Mapping


@dataclass(frozen=True, slots=True)
class MetricSignalInput:
    metric_code: str
    market: str
    asset_symbol: str | None
    effective_at: datetime
    value: Decimal
    z_score: Decimal | None = None
    percentile: Decimal | None = None
    trailing_deviation: Decimal | None = None
    regime_label: str | None = None
    source_conflict: bool = False
    is_fresh: bool = True
    score_visible: bool = True
    methodology_version: str = "v1"
    dimensions: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.effective_at.tzinfo is None or self.effective_at.utcoffset() is None:
            raise ValueError("effective_at must be timezone-aware.")
        if self.percentile is not None and not (
            Decimal("0") <= self.percentile <= Decimal("1")
        ):
            raise ValueError("percentile must be between zero and one.")
        if self.trailing_deviation is not None and self.trailing_deviation < 0:
            raise ValueError("trailing_deviation must not be negative.")


@dataclass(frozen=True, slots=True)
class SignalCandidate:
    kind: str
    metric_code: str
    market: str
    asset_symbol: str | None
    effective_at: datetime
    methodology_version: str
    idempotency_key: str
    details: Mapping[str, str]


def _canonical_decimal(value: Decimal | None) -> str | None:
    return format(value, "f") if value is not None else None


def _candidate(current: MetricSignalInput, kind: str) -> SignalCandidate:
    details = {
        "value": _canonical_decimal(current.value) or "0",
        "zScore": _canonical_decimal(current.z_score) or "",
        "percentile": _canonical_decimal(current.percentile) or "",
        "regimeLabel": current.regime_label or "",
    }
    payload = {
        "asset": current.asset_symbol,
        "dimensions": dict(sorted(current.dimensions.items())),
        "effectiveAt": current.effective_at.isoformat(timespec="microseconds"),
        "kind": kind,
        "market": current.market,
        "methodologyVersion": current.methodology_version,
        "metricCode": current.metric_code,
    }
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )
    return SignalCandidate(
        kind=kind,
        metric_code=current.metric_code,
        market=current.market,
        asset_symbol=current.asset_symbol,
        effective_at=current.effective_at,
        methodology_version=current.methodology_version,
        idempotency_key=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        details=details,
    )


def _z_extreme(value: Decimal | None) -> int:
    if value is None or abs(value) < Decimal("2"):
        return 0
    return 1 if value > 0 else -1


def _percentile_extreme(value: Decimal | None) -> int:
    if value is None:
        return 0
    if value <= Decimal("0.05"):
        return -1
    if value >= Decimal("0.95"):
        return 1
    return 0


def _sign(value: Decimal) -> int:
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0


def detect_signals(
    current: MetricSignalInput, previous: MetricSignalInput | None = None
) -> tuple[SignalCandidate, ...]:
    candidates: list[SignalCandidate] = []

    current_z = _z_extreme(current.z_score)
    previous_z = _z_extreme(previous.z_score) if previous is not None else 0
    if current_z and current_z != previous_z:
        candidates.append(_candidate(current, "zscore_extreme"))

    current_percentile = _percentile_extreme(current.percentile)
    previous_percentile = (
        _percentile_extreme(previous.percentile) if previous is not None else 0
    )
    if current_percentile and current_percentile != previous_percentile:
        candidates.append(_candidate(current, "percentile_extreme"))

    if (
        previous is not None
        and current.trailing_deviation is not None
        and current.trailing_deviation > 0
        and _sign(current.value) != 0
        and _sign(previous.value) != 0
        and _sign(current.value) != _sign(previous.value)
        and abs(current.value) >= current.trailing_deviation
    ):
        candidates.append(_candidate(current, "flow_sign_change"))

    if (
        previous is not None
        and current.regime_label is not None
        and previous.regime_label is not None
        and current.regime_label != previous.regime_label
    ):
        candidates.append(_candidate(current, "regime_label_change"))

    if current.source_conflict and (
        previous is None or not previous.source_conflict
    ):
        candidates.append(_candidate(current, "source_conflict"))

    if previous is not None and (
        current.is_fresh,
        current.score_visible,
    ) != (
        previous.is_fresh,
        previous.score_visible,
    ):
        candidates.append(_candidate(current, "freshness_transition"))

    return tuple(candidates)
