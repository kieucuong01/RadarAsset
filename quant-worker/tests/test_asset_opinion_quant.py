from datetime import datetime, timedelta, timezone
from decimal import Decimal

from smart_insights.asset_opinion_contracts import AssetCandidate, MarketBar, QuantFact
from smart_insights.asset_opinion_quant import build_quant_opinion


NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)


def candidate(
    symbol: str,
    *,
    weight: str = "0",
    market: str | None = None,
) -> AssetCandidate:
    resolved_market = market or ("crypto" if symbol == "BTC" else "gold")
    return AssetCandidate(
        symbol=symbol,
        name=symbol,
        market=resolved_market,
        portfolio_weight=Decimal(weight),
        watchlist_rank=0,
        quantity=Decimal("1") if Decimal(weight) else Decimal("0"),
        average_cost=Decimal("100") if Decimal(weight) else None,
    )


def bars(
    count: int,
    *,
    symbol: str = "BTC",
    start: str = "100",
    step: str = "1",
) -> tuple[MarketBar, ...]:
    first = Decimal(start)
    increment = Decimal(step)
    return tuple(
        MarketBar(
            id=f"{symbol}-bar-{index}",
            symbol=symbol,
            ts=NOW - timedelta(days=count - index - 1),
            close=first + increment * index,
            observed_at=NOW - timedelta(days=count - index - 1),
        )
        for index in range(count)
    )


def fact(
    metric: str,
    source: str,
    *,
    score: str | None = "40",
    value: str = "1",
    fresh: bool = True,
    critical: bool = False,
    contradicting: bool = False,
) -> QuantFact:
    return QuantFact(
        id=f"fact-{metric}-{source}",
        metric_code=metric,
        value=Decimal(value),
        unit="RATIO",
        effective_at=NOW,
        observed_at=NOW,
        source_family=source,
        source_code=source,
        source_url=f"https://example.test/{source}",
        signed_score=Decimal(score) if score is not None else None,
        confidence=Decimal("80"),
        fresh=fresh,
        critical=critical,
        methodology_version="asset-opinion-facts-v1",
        contradicting=contradicting,
    )


def supportive_crypto_facts() -> tuple[QuantFact, ...]:
    return (
        fact("crypto.etf.net_flow_usd", "farside", score="70"),
        fact("crypto.fear_greed.index", "alternative-fng", score="40"),
        fact("macro.regime.score", "fred", score="30"),
    )


def test_fact_sheet_ignores_future_and_uses_independent_sources() -> None:
    future = MarketBar("future", "BTC", NOW + timedelta(days=1), Decimal("999"), NOW + timedelta(days=1))

    opinion = build_quant_opinion(
        asset=candidate("BTC"),
        bars=bars(61) + (future,),
        specialized=(fact("crypto.etf.net_flow_usd", "farside"),),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert opinion.gate.passed is True
    assert opinion.gate.source_families == ("farside", "market_bars")
    assert all(row.effective_at <= NOW for row in opinion.facts)
    assert all("future" not in row.underlying_ids for row in opinion.facts)


def test_gate_fails_closed_for_short_history_or_stale_critical_fact() -> None:
    short = build_quant_opinion(
        asset=candidate("XAU"),
        bars=bars(59, symbol="XAU"),
        specialized=(),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    stale = build_quant_opinion(
        asset=candidate("XAU"),
        bars=bars(80, symbol="XAU"),
        specialized=(
            fact("macro.real_yield.10y_pct", "fred", fresh=False, critical=True),
        ),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert short.stance == "INSUFFICIENT_DATA"
    assert "MINIMUM_60_DAILY_BARS" in short.gate.failed_gates
    assert "CRITICAL_INPUT_STALE" in stale.gate.failed_gates
    assert stale.personalized_action == "NO_ACTION_INSUFFICIENT_DATA"


def test_old_market_bars_are_critical_stale_inputs() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC"),
        bars=bars(80),
        specialized=(fact("crypto.etf.net_flow_usd", "farside"),),
        as_of=NOW + timedelta(days=10),
        risk_tolerance="moderate",
    )

    assert "CRITICAL_INPUT_STALE" in opinion.gate.failed_gates
    assert opinion.freshness == "stale"


def test_concentrated_positive_position_still_reviews_risk() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC", weight="0.31"),
        bars=bars(220),
        specialized=supportive_crypto_facts(),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert opinion.stance in {"CONSTRUCTIVE", "POSITIVE"}
    assert opinion.personalized_action == "REVIEW_REDUCE_RISK"
    assert opinion.unrealized_return is not None


def test_constructive_unheld_asset_can_be_reviewed_for_increase() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC"),
        bars=bars(220),
        specialized=supportive_crypto_facts(),
        as_of=NOW,
        risk_tolerance="aggressive",
    )

    assert opinion.stance in {"CONSTRUCTIVE", "POSITIVE"}
    assert opinion.personalized_action == "REVIEW_INCREASE"


def test_contradiction_waits_for_confirmation_before_increasing() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC"),
        bars=bars(220),
        specialized=(
            fact("crypto.etf.net_flow_usd", "farside", score="70"),
            fact(
                "macro.real_yield.10y_pct",
                "fred",
                score="-60",
                contradicting=True,
            ),
        ),
        as_of=NOW,
        risk_tolerance="aggressive",
    )

    assert opinion.gate.passed is True
    assert opinion.personalized_action == "WAIT_CONFIRMATION"


def test_same_inputs_produce_identical_opinion() -> None:
    inputs = dict(
        asset=candidate("BTC"),
        bars=bars(220),
        specialized=supportive_crypto_facts(),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert build_quant_opinion(**inputs) == build_quant_opinion(**inputs)


def test_common_facts_include_historical_risk_percentiles() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC"),
        bars=bars(220),
        specialized=supportive_crypto_facts(),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    metric_codes = {row.metric_code for row in opinion.facts}
    assert "market.realized_volatility_20d_percentile" in metric_codes
    assert "market.drawdown_percentile" in metric_codes


def test_equity_fact_sheet_includes_relative_strength_to_vnindex() -> None:
    opinion = build_quant_opinion(
        asset=candidate("FPT", market="equity"),
        bars=(
            *bars(80, symbol="FPT", start="100", step="2"),
            *bars(80, symbol="VNINDEX", start="100", step="1"),
        ),
        specialized=(fact("equity.liquidity.turnover", "vci", score="30"),),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    relative = next(row for row in opinion.facts if row.metric_code == "market.relative_strength_20d")
    assert relative.value > 0
    assert any(identifier.startswith("VNINDEX-bar-") for identifier in relative.underlying_ids)


def test_kronos_facts_never_enter_the_opinion() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC"),
        bars=bars(220),
        specialized=(fact("kronos.btc.forecast", "kronos", score="100"),),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert all("kronos" not in row.metric_code.casefold() for row in opinion.facts)
    assert "SOURCE_FAMILIES_MINIMUM_2" in opinion.gate.failed_gates


def test_btc_80_20_ledger_exposes_exact_weighted_contributions() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC"),
        bars=bars(220),
        specialized=(
            fact("crypto.etf.net_flow_usd", "farside", score="80"),
            fact(
                "crypto.coinshares.net_flow_usd",
                "coinshares-weekly",
                score="40",
            ),
            fact("crypto.fear_greed.index", "alternative-fng", score="20"),
            fact(
                "macro.regime.score",
                "fred",
                score="-20",
                contradicting=True,
            ),
        ),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert {row.code: row.configured_weight for row in opinion.pillars} == {
        "trend": Decimal("0.40"),
        "fund_flow": Decimal("0.30"),
        "macro": Decimal("0.15"),
        "sentiment_onchain": Decimal("0.15"),
    }
    fund_flow = next(row for row in opinion.pillars if row.code == "fund_flow")
    assert fund_flow.score == Decimal("70")
    assert len(opinion.decision_inputs) <= 12
    assert sum(
        (row.contribution for row in opinion.pillars), Decimal("0")
    ) == opinion.total_contribution
    assert (
        opinion.formula
        == "asset_score = Σ(pillar_score × pillar_weight) ÷ data_coverage"
    )
    assert opinion.contradicting_fact_ids


def test_fear_greed_has_a_direct_explainable_score_without_signal_snapshot() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC"),
        bars=bars(220),
        specialized=(
            fact(
                "crypto.fear_greed.index",
                "alternative-fng",
                score=None,
                value="75",
            ),
            fact("crypto.etf.net_flow_usd", "farside", score="30"),
        ),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    fear = next(
        row
        for row in opinion.decision_inputs
        if row.metric_code == "crypto.fear_greed.index"
    )
    assert fear.normalized_score == Decimal("50")
    assert fear.normalization_method == "fear_greed_centered_v1"


def test_xau_uses_trend_macro_and_optional_positioning_weights() -> None:
    opinion = build_quant_opinion(
        asset=candidate("XAU", market="gold"),
        bars=bars(220, symbol="XAU"),
        specialized=(
            fact("macro.real_yield.10y_pct", "fred", score="-40"),
            fact("macro.usd_broad_index", "fred-usd", score="-20"),
            fact("gold.cftc.managed_money_net_oi", "cftc", score="30"),
        ),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert {row.code: row.configured_weight for row in opinion.pillars} == {
        "trend": Decimal("0.55"),
        "macro": Decimal("0.30"),
        "positioning": Decimal("0.15"),
    }
    assert opinion.data_coverage == Decimal("1.00")


def test_highlight_selection_is_bounded_and_uses_contribution_order() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC"),
        bars=bars(220),
        specialized=(
            fact("crypto.etf.net_flow_usd", "farside", score="90"),
            fact("crypto.coinshares.net_flow_usd", "coinshares", score="60"),
            fact("crypto.fear_greed.index", "alternative-fng", score="40"),
            fact("crypto.onchain.active_addresses", "coinmetrics", score="30"),
            fact("crypto.onchain.adjusted_transfer_usd", "coinmetrics-2", score="20"),
            fact("crypto.onchain.nvt", "coinmetrics-3", score="-30"),
            fact("macro.real_yield.10y_pct", "fred", score="-50"),
            fact("macro.usd_broad_index", "fred-usd", score="-40"),
        ),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert 1 <= len(opinion.supporting_fact_ids) <= 5
    assert 1 <= len(opinion.contradicting_fact_ids) <= 3
    contributions = {
        row.fact_id: abs(row.contribution) for row in opinion.decision_inputs
    }
    assert list(opinion.supporting_fact_ids) == sorted(
        opinion.supporting_fact_ids,
        key=lambda fact_id: (-contributions[fact_id], fact_id),
    )
