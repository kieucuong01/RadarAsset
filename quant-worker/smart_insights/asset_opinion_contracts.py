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
class PillarScore:
    code: str
    score: Decimal
    configured_weight: Decimal
    confidence: Decimal
    fact_ids: tuple[str, ...]
    series: tuple[tuple[str, Decimal], ...] = ()

    def __post_init__(self) -> None:
        _require_text(self.code, "code")
        for value, field_name, minimum, maximum in (
            (self.score, "score", Decimal("-100"), Decimal("100")),
            (self.configured_weight, "configured_weight", Decimal("0"), Decimal("1")),
            (self.confidence, "confidence", Decimal("0"), Decimal("100")),
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


@dataclass(frozen=True, slots=True)
class AssetOpinionMarketData:
    bars: tuple[tuple[str, tuple[MarketBar, ...]], ...]
    facts: tuple[tuple[str, tuple[QuantFact, ...]], ...]

    def bars_for(self, symbol: str) -> tuple[MarketBar, ...]:
        return next((rows for key, rows in self.bars if key == symbol), ())

    def facts_for(self, symbol: str) -> tuple[QuantFact, ...]:
        return next((rows for key, rows in self.facts if key == symbol), ())
