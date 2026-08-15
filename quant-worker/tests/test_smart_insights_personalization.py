from datetime import datetime, timedelta, timezone
from decimal import Decimal

from smart_insights.personalization import (
    CandidateSignal,
    PortfolioPosition,
    UserInsightPreference,
    default_preferences,
    rank_candidates,
    relevance_score,
)


NOW = datetime(2026, 8, 13, tzinfo=timezone.utc)


def candidate(signal_id: str, market: str, asset: str, severity: int = 1) -> CandidateSignal:
    return CandidateSignal(
        signal_id=signal_id, market=market, affected_assets=(asset,),
        effective_at=NOW, event_at=NOW + timedelta(hours=12), z_score=Decimal("2.1"),
        regime_change=False, source_conflict=False, data_confidence=Decimal("80"),
        risk_severity=severity,
    )


def test_relevance_uses_frozen_component_weights() -> None:
    result = relevance_score(
        exposure=Decimal("80"), magnitude=Decimal("70"), proximity=Decimal("100"),
        interest=Decimal("100"), data_confidence=Decimal("60"),
    )
    assert result.total == Decimal("81.50")


def test_ranking_changes_with_portfolio_but_signal_does_not() -> None:
    candidates = (candidate("btc", "crypto", "BTC"), candidate("gold", "gold", "XAU"))
    btc_heavy = rank_candidates(
        candidates, portfolio=(PortfolioPosition("BTC", Decimal("0.80")), PortfolioPosition("XAU", Decimal("0.20"))),
        preferences=default_preferences(), now=NOW,
    )
    gold_heavy = rank_candidates(
        candidates, portfolio=(PortfolioPosition("BTC", Decimal("0.10")), PortfolioPosition("XAU", Decimal("0.90"))),
        preferences=default_preferences(), now=NOW,
    )
    assert btc_heavy.primary[0].market == "crypto"
    assert gold_heavy.primary[0].market == "gold"
    assert btc_heavy.primary[0].signal_id in {row.signal_id for row in gold_heavy.all_candidates}


def test_missing_portfolio_uses_preferences_without_fake_exposure() -> None:
    preferences = UserInsightPreference(markets=("gold",), assets=("XAU",))
    ranked = rank_candidates((candidate("gold", "gold", "XAU"),), portfolio=(), preferences=preferences, now=NOW)
    assert ranked.portfolio_state == "missing"
    assert ranked.primary[0].components["exposure"] == Decimal("0")


def test_portfolio_position_preserves_cost_context_for_asset_opinions() -> None:
    position = PortfolioPosition(
        "BTC",
        Decimal("0.25"),
        quantity=Decimal("2"),
        average_cost=Decimal("100"),
    )

    assert position.quantity == Decimal("2")
    assert position.average_cost == Decimal("100")
