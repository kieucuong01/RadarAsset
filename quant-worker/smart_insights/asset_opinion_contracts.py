from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


def _require_text(value: str, field_name: str) -> None:
    if not value.strip():
        raise ValueError(f"{field_name} is required.")


def _require_aware(value: datetime, field_name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware.")


def _require_finite(value: Decimal, field_name: str) -> None:
    if not value.is_finite():
        raise ValueError(f"{field_name} must be finite.")


@dataclass(frozen=True, slots=True)
class AssetCandidate:
    symbol: str
    name: str
    market: str
    portfolio_weight: Decimal
    watchlist_rank: int
    quantity: Decimal = Decimal("0")
    average_cost: Decimal | None = None

    def __post_init__(self) -> None:
        _require_text(self.symbol, "symbol")
        _require_text(self.name, "name")
        _require_text(self.market, "market")
        _require_finite(self.portfolio_weight, "portfolio_weight")
        _require_finite(self.quantity, "quantity")
        if self.average_cost is not None:
            _require_finite(self.average_cost, "average_cost")
            if self.average_cost <= 0:
                raise ValueError("average_cost must be positive.")
        if self.watchlist_rank < 0:
            raise ValueError("watchlist_rank must not be negative.")


@dataclass(frozen=True, slots=True)
class UniverseResult:
    assets: tuple[AssetCandidate, ...]
    excluded_representatives: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class MarketBar:
    id: str
    symbol: str
    ts: datetime
    close: Decimal
    observed_at: datetime

    def __post_init__(self) -> None:
        _require_text(self.id, "id")
        _require_text(self.symbol, "symbol")
        _require_aware(self.ts, "ts")
        _require_aware(self.observed_at, "observed_at")
        _require_finite(self.close, "close")
        if self.close <= 0:
            raise ValueError("close must be positive.")


@dataclass(frozen=True, slots=True)
class QuantFact:
    id: str
    metric_code: str
    value: Decimal
    unit: str
    effective_at: datetime
    observed_at: datetime
    source_family: str
    source_code: str
    source_url: str
    signed_score: Decimal | None
    confidence: Decimal
    fresh: bool
    critical: bool
    methodology_version: str
    underlying_ids: tuple[str, ...] = ()
    contradicting: bool = False
    dimensions: tuple[tuple[str, str], ...] = ()
    percentile: Decimal | None = None
    source_input_weight: Decimal | None = None
    normalization_method: str = "source_signal"
    signal_metric_code: str | None = None
    signal_market: str | None = None

    def __post_init__(self) -> None:
        for value, field_name in (
            (self.id, "id"),
            (self.metric_code, "metric_code"),
            (self.unit, "unit"),
            (self.source_family, "source_family"),
            (self.source_code, "source_code"),
            (self.source_url, "source_url"),
            (self.methodology_version, "methodology_version"),
        ):
            _require_text(value, field_name)
        _require_aware(self.effective_at, "effective_at")
        _require_aware(self.observed_at, "observed_at")
        _require_finite(self.value, "value")
        _require_finite(self.confidence, "confidence")
        if self.signed_score is not None:
            _require_finite(self.signed_score, "signed_score")
            if not Decimal("-100") <= self.signed_score <= Decimal("100"):
                raise ValueError("signed_score must be between -100 and 100.")
        if self.percentile is not None:
            _require_finite(self.percentile, "percentile")
            if not Decimal("0") <= self.percentile <= Decimal("1"):
                raise ValueError("percentile must be between 0 and 1.")
        if self.source_input_weight is not None:
            _require_finite(self.source_input_weight, "source_input_weight")
            if not Decimal("0") <= self.source_input_weight <= Decimal("1"):
                raise ValueError("source_input_weight must be between 0 and 1.")
        if tuple(sorted(self.dimensions)) != self.dimensions:
            raise ValueError("dimensions must be sorted.")
        if not Decimal("0") <= self.confidence <= Decimal("100"):
            raise ValueError("confidence must be between 0 and 100.")


@dataclass(frozen=True, slots=True)
class DataGateResult:
    passed: bool
    failed_gates: tuple[str, ...]
    source_families: tuple[str, ...]
    numeric_fact_count: int

    def __post_init__(self) -> None:
        if self.numeric_fact_count < 0:
            raise ValueError("numeric_fact_count must not be negative.")
        if self.passed == bool(self.failed_gates):
            raise ValueError("passed must match failed_gates.")


@dataclass(frozen=True, slots=True)
class DecisionInput:
    fact_id: str
    metric_code: str
    pillar_code: str
    raw_value: Decimal
    unit: str
    normalized_score: Decimal
    input_weight: Decimal
    weighted_score: Decimal
    pillar_weight: Decimal
    contribution: Decimal
    normalization_method: str
    percentile: Decimal | None = None
    lookback: str | None = None

    def __post_init__(self) -> None:
        for value, field_name in (
            (self.fact_id, "fact_id"),
            (self.metric_code, "metric_code"),
            (self.pillar_code, "pillar_code"),
            (self.unit, "unit"),
            (self.normalization_method, "normalization_method"),
        ):
            _require_text(value, field_name)
        for value, field_name in (
            (self.raw_value, "raw_value"),
            (self.normalized_score, "normalized_score"),
            (self.input_weight, "input_weight"),
            (self.weighted_score, "weighted_score"),
            (self.pillar_weight, "pillar_weight"),
            (self.contribution, "contribution"),
        ):
            _require_finite(value, field_name)
        if not Decimal("-100") <= self.normalized_score <= Decimal("100"):
            raise ValueError("normalized_score must be between -100 and 100.")
        if not Decimal("0") <= self.input_weight <= Decimal("1"):
            raise ValueError("input_weight must be between 0 and 1.")
        if not Decimal("0") <= self.pillar_weight <= Decimal("1"):
            raise ValueError("pillar_weight must be between 0 and 1.")
        if self.percentile is not None:
            _require_finite(self.percentile, "percentile")
            if not Decimal("0") <= self.percentile <= Decimal("1"):
                raise ValueError("percentile must be between 0 and 1.")


@dataclass(frozen=True, slots=True)
class PillarScore:
    code: str
    score: Decimal
    configured_weight: Decimal
    confidence: Decimal
    fact_ids: tuple[str, ...]
    series: tuple[tuple[str, Decimal], ...] = ()
    available_input_weight: Decimal = Decimal("1")
    contribution: Decimal = Decimal("0")

    def __post_init__(self) -> None:
        _require_text(self.code, "code")
        for value, field_name, minimum, maximum in (
            (self.score, "score", Decimal("-100"), Decimal("100")),
            (self.configured_weight, "configured_weight", Decimal("0"), Decimal("1")),
            (self.confidence, "confidence", Decimal("0"), Decimal("100")),
            (self.available_input_weight, "available_input_weight", Decimal("0"), Decimal("1")),
        ):
            _require_finite(value, field_name)
            if not minimum <= value <= maximum:
                raise ValueError(f"{field_name} must be between {minimum} and {maximum}.")


@dataclass(frozen=True, slots=True)
class QuantAssetOpinion:
    asset: AssetCandidate
    stance: str
    quant_score: Decimal | None
    confidence: Decimal
    data_coverage: Decimal
    gate: DataGateResult
    pillars: tuple[PillarScore, ...]
    facts: tuple[QuantFact, ...]
    personalized_action: str
    horizon: str
    freshness: str
    methodology_version: str
    unrealized_return: Decimal | None = None
    decision_inputs: tuple[DecisionInput, ...] = ()
    total_contribution: Decimal = Decimal("0")
    formula: str = "asset_score = Σ(pillar_score × pillar_weight) ÷ data_coverage"
    supporting_fact_ids: tuple[str, ...] = ()
    contradicting_fact_ids: tuple[str, ...] = ()
    invalidation_conditions: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        for value, field_name in (
            (self.stance, "stance"),
            (self.personalized_action, "personalized_action"),
            (self.horizon, "horizon"),
            (self.freshness, "freshness"),
            (self.methodology_version, "methodology_version"),
        ):
            _require_text(value, field_name)
        _require_finite(self.confidence, "confidence")
        _require_finite(self.data_coverage, "data_coverage")
        if self.quant_score is not None:
            _require_finite(self.quant_score, "quant_score")
            if not Decimal("-100") <= self.quant_score <= Decimal("100"):
                raise ValueError("quant_score must be between -100 and 100.")
        if not Decimal("0") <= self.confidence <= Decimal("100"):
            raise ValueError("confidence must be between 0 and 100.")
        if not Decimal("0") <= self.data_coverage <= Decimal("1"):
            raise ValueError("data_coverage must be between 0 and 1.")
        _require_finite(self.total_contribution, "total_contribution")
        _require_text(self.formula, "formula")
        if len(self.decision_inputs) > 12:
            raise ValueError("decision_inputs must contain at most 12 rows.")
        decision_ids = {row.fact_id for row in self.decision_inputs}
        if not set(self.supporting_fact_ids) <= decision_ids:
            raise ValueError("supporting_fact_ids must reference decision inputs.")
        if not set(self.contradicting_fact_ids) <= decision_ids:
            raise ValueError("contradicting_fact_ids must reference decision inputs.")


@dataclass(frozen=True, slots=True)
class AssetOpinionMarketData:
    bars: tuple[tuple[str, tuple[MarketBar, ...]], ...]
    facts: tuple[tuple[str, tuple[QuantFact, ...]], ...]

    def bars_for(self, symbol: str) -> tuple[MarketBar, ...]:
        return next((rows for key, rows in self.bars if key == symbol), ())

    def facts_for(self, symbol: str) -> tuple[QuantFact, ...]:
        return next((rows for key, rows in self.facts if key == symbol), ())


@dataclass(frozen=True, slots=True)
class AssetOpinionAiOutput:
    thesis: str
    bull_case: str
    base_case: str
    bear_case: str
    invalidation_conditions: tuple[str, ...]
    supporting_evidence_ids: tuple[str, ...]
    contradicting_evidence_ids: tuple[str, ...]
    affected_assets: tuple[str, ...]
    time_horizon: str
    personalized_action: str
    confidence: int

    @property
    def prose(self) -> str:
        return "\n".join(
            (
                self.thesis,
                self.bull_case,
                self.base_case,
                self.bear_case,
                *self.invalidation_conditions,
            )
        )


@dataclass(frozen=True, slots=True)
class AssetOpinionGroundingAccepted:
    output: AssetOpinionAiOutput
    bundle_fingerprint: str


@dataclass(frozen=True, slots=True)
class AssetOpinionDraft:
    symbol: str
    signal_key: str
    quant: QuantAssetOpinion
    evidence_bundle: object
    explanation_status: str
    ai_output: AssetOpinionAiOutput | None
    rejection_code: str | None
