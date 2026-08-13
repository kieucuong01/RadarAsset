from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import datetime
from decimal import Decimal, ROUND_HALF_EVEN
import hashlib
import json
from typing import Any


@dataclass(frozen=True, slots=True)
class DisplayedNumber:
    raw: str
    display: str
    normalized_tokens: tuple[str, ...]
    format_rule: str


@dataclass(frozen=True, slots=True)
class EvidenceObservation:
    id: str
    metric_code: str
    asset: str | None
    value: Decimal
    unit: str
    effective_start: datetime
    effective_end: datetime
    observed_at: datetime
    source_code: str
    source_url: str
    methodology_version: str
    warnings: tuple[str, ...]
    decimals: int = 2


@dataclass(frozen=True, slots=True)
class SignalEvidenceInput:
    signal_id: str
    market: str
    affected_assets: tuple[str, ...]
    data_confidence: Decimal


@dataclass(frozen=True, slots=True)
class EvidenceFact:
    evidence_id: str
    metric_observation_id: str
    metric_code: str
    asset: str | None
    raw_value: str
    display_value: str
    normalized_tokens: tuple[str, ...]
    format_rule: str
    unit: str
    effective_start: str
    effective_end: str
    observed_at: str
    source_code: str
    source_url: str
    methodology_version: str
    warnings: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class EvidenceBundle:
    signal_id: str
    market: str
    affected_assets: tuple[str, ...]
    evidence: tuple[EvidenceFact, ...]
    supporting_evidence_ids: tuple[str, ...]
    contradicting_evidence_ids: tuple[str, ...]
    historical_comparisons: tuple[dict[str, object], ...]
    data_confidence_ceiling: Decimal
    as_of: str
    tenant_id: str
    fingerprint: str

    def to_json(self, *, include_fingerprint: bool = True) -> str:
        payload: dict[str, Any] = asdict(self)
        payload["data_confidence_ceiling"] = format(self.data_confidence_ceiling, "f")
        if not include_fingerprint:
            payload.pop("fingerprint", None)
        return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def canonical_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _fixed(value: Decimal, decimals: int) -> str:
    if decimals < 0 or decimals > 10:
        raise ValueError("Evidence decimals must be between zero and ten.")
    quantum = Decimal(1).scaleb(-decimals)
    return format(value.quantize(quantum, rounding=ROUND_HALF_EVEN), f".{decimals}f")


def format_evidence_number(*, value: Decimal, unit: str, decimals: int = 2) -> DisplayedNumber:
    if not value.is_finite():
        raise ValueError("Evidence value must be finite.")
    fixed = _fixed(value, decimals)
    suffix = f"{decimals}dp"
    formats = {
        "PERCENT": (f"{fixed}%", f"percent_{suffix}"),
        "INDEX": (fixed, f"index_{suffix}"),
        "BASIS_POINTS": (f"{fixed} bps", f"basis_points_{suffix}"),
        "USD_MILLION": (f"${fixed}m", f"currency_compact_usd_million_{suffix}"),
        "TONNES": (f"{fixed} t", f"tonnes_{suffix}"),
        "COUNT": (fixed, f"count_{suffix}"),
        "RATIO": (fixed, f"ratio_{suffix}"),
        "SCORE": (fixed, f"score_{suffix}"),
        "DAYS": (f"{fixed} days", f"duration_days_{suffix}"),
    }
    if unit not in formats:
        raise ValueError(f"Unsupported evidence unit: {unit}")
    display, rule = formats[unit]
    tokens = (fixed, display) if fixed != display else (fixed,)
    return DisplayedNumber(format(value, "f"), display, tokens, rule)


def _iso(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Evidence timestamps must be timezone-aware.")
    return value.isoformat(timespec="seconds")


def build_bundle(
    *, signal: SignalEvidenceInput, observations: tuple[EvidenceObservation, ...],
    tenant_id: str, as_of: datetime, supporting_ids: tuple[str, ...] | None = None,
    contradicting_ids: tuple[str, ...] = (),
    historical_comparisons: tuple[dict[str, object], ...] = (),
) -> EvidenceBundle:
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware.")
    facts: list[EvidenceFact] = []
    for row in observations:
        if row.observed_at > as_of or row.effective_end > as_of:
            continue
        displayed = format_evidence_number(value=row.value, unit=row.unit, decimals=row.decimals)
        evidence_id = canonical_sha256(f"{tenant_id}:{signal.signal_id}:{row.id}")[:32]
        facts.append(EvidenceFact(
            evidence_id=evidence_id, metric_observation_id=row.id, metric_code=row.metric_code,
            asset=row.asset, raw_value=format(row.value, "f"), display_value=displayed.display,
            normalized_tokens=displayed.normalized_tokens, format_rule=displayed.format_rule,
            unit=row.unit, effective_start=_iso(row.effective_start), effective_end=_iso(row.effective_end),
            observed_at=_iso(row.observed_at), source_code=row.source_code, source_url=row.source_url,
            methodology_version=row.methodology_version, warnings=row.warnings,
        ))
    ordered = tuple(sorted(facts, key=lambda row: (row.metric_code, row.asset or "", row.effective_end, row.evidence_id)))
    available = {row.evidence_id for row in ordered}
    support = tuple(sorted(set(supporting_ids or tuple(available)) & available))
    contradictions = tuple(sorted(set(contradicting_ids) & available))
    provisional = EvidenceBundle(
        signal.signal_id, signal.market, tuple(sorted(set(signal.affected_assets))), ordered,
        support, contradictions, historical_comparisons, signal.data_confidence,
        _iso(as_of), tenant_id, "",
    )
    return replace(provisional, fingerprint=canonical_sha256(provisional.to_json(include_fingerprint=False)))
