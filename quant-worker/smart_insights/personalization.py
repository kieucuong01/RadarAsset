from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


RELEVANCE_WEIGHTS = {
    "exposure": Decimal("0.35"),
    "magnitude": Decimal("0.25"),
    "proximity": Decimal("0.15"),
    "interest": Decimal("0.15"),
    "data_confidence": Decimal("0.10"),
}


@dataclass(frozen=True, slots=True)
class UserInsightPreference:
    markets: tuple[str, ...] = ("crypto", "macro", "gold")
    assets: tuple[str, ...] = ()
    locale: str = "vi"
    base_currency: str = "USD"
    investment_horizon: str = "WEEKS_1_4"
    risk_tolerance: str = "moderate"
    high_impact_alerts: bool = True


@dataclass(frozen=True, slots=True)
class PortfolioPosition:
    asset: str
    weight: Decimal
    quantity: Decimal = Decimal("0")
    average_cost: Decimal | None = None


@dataclass(frozen=True, slots=True)
class CandidateSignal:
    signal_id: str
    market: str
    affected_assets: tuple[str, ...]
    effective_at: datetime
    event_at: datetime | None
    z_score: Decimal | None
    regime_change: bool
    source_conflict: bool
    data_confidence: Decimal
    risk_severity: int = 0


@dataclass(frozen=True, slots=True)
class RelevanceResult:
    total: Decimal
    components: dict[str, Decimal]


@dataclass(frozen=True, slots=True)
class RankedSignal:
    signal_id: str
    market: str
    affected_assets: tuple[str, ...]
    effective_at: datetime
    risk_severity: int
    relevance: Decimal
    components: dict[str, Decimal]


@dataclass(frozen=True, slots=True)
class RankedSelection:
    all_candidates: tuple[RankedSignal, ...]
    primary: tuple[RankedSignal, ...]
    risk_alerts: tuple[RankedSignal, ...]
    portfolio_state: str


def default_preferences() -> UserInsightPreference:
    return UserInsightPreference()


def _bounded(value: Decimal) -> Decimal:
    return max(Decimal("0"), min(Decimal("100"), value))


def relevance_score(**components: Decimal) -> RelevanceResult:
    if set(components) != set(RELEVANCE_WEIGHTS):
        raise ValueError("Relevance components must match the frozen contract.")
    normalized = {key: _bounded(value) for key, value in components.items()}
    total = sum((RELEVANCE_WEIGHTS[key] * normalized[key] for key in RELEVANCE_WEIGHTS), Decimal("0"))
    return RelevanceResult(total.quantize(Decimal("0.01")), normalized)


def signal_magnitude(z_score: Decimal | None, *, regime_change: bool, source_conflict: bool) -> Decimal:
    if regime_change or source_conflict:
        return Decimal("100")
    return min(abs(z_score or Decimal("0")) / Decimal("3"), Decimal("1")) * Decimal("100")


def _proximity(event_at: datetime | None, now: datetime) -> Decimal:
    if event_at is None:
        return Decimal("0")
    hours = Decimal(str((event_at - now).total_seconds() / 3600))
    if hours < 0:
        return Decimal("0")
    if hours <= 24:
        return Decimal("100")
    if hours <= 72:
        return Decimal("70")
    if hours <= 168:
        return Decimal("40")
    return Decimal("0")


def rank_candidates(
    candidates: tuple[CandidateSignal, ...], *, portfolio: tuple[PortfolioPosition, ...],
    preferences: UserInsightPreference, now: datetime, watchlist: tuple[str, ...] = (),
) -> RankedSelection:
    weights = {row.asset.upper(): abs(row.weight) for row in portfolio}
    largest = max(weights.values(), default=Decimal("0"))
    ranked: list[RankedSignal] = []
    selected_assets = {asset.upper() for asset in preferences.assets}
    watched = {asset.upper() for asset in watchlist}
    for candidate in candidates:
        assets = {asset.upper() for asset in candidate.affected_assets}
        affected_weight = sum((weights.get(asset, Decimal("0")) for asset in assets), Decimal("0"))
        exposure = Decimal("0") if largest == 0 else min(Decimal("100"), affected_weight / largest * Decimal("100"))
        explicitly_interested = candidate.market in preferences.markets or bool(assets & selected_assets)
        interest = Decimal("100") if explicitly_interested else Decimal("60") if assets & watched else Decimal("0")
        relevance = relevance_score(
            exposure=exposure,
            magnitude=signal_magnitude(candidate.z_score, regime_change=candidate.regime_change, source_conflict=candidate.source_conflict),
            proximity=_proximity(candidate.event_at, now), interest=interest,
            data_confidence=candidate.data_confidence,
        )
        ranked.append(RankedSignal(
            candidate.signal_id, candidate.market, candidate.affected_assets,
            candidate.effective_at, candidate.risk_severity, relevance.total, relevance.components,
        ))
    ordered = tuple(sorted(ranked, key=lambda row: (-row.relevance, -row.risk_severity, -row.effective_at.timestamp(), row.signal_id)))
    primary: list[RankedSignal] = []
    used: set[tuple[str, tuple[str, ...]]] = set()
    for row in ordered:
        key = (row.market, tuple(sorted(row.affected_assets)))
        if key not in used:
            primary.append(row)
            used.add(key)
        if len(primary) == 3:
            break
    risk = tuple(row for row in ordered if row.risk_severity > 0)[:2]
    return RankedSelection(ordered, tuple(primary), risk, "available" if portfolio else "missing")
