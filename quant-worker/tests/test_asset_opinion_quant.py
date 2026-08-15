from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from smart_insights.asset_opinion_contracts import AssetCandidate, MarketBar, QuantFact
from smart_insights.asset_opinion_quant import build_btc_context_facts, build_quant_opinion
from smart_insights.asset_opinion_rules import pillar_weights


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


def alt_context_facts(*, etf: bool = False, macro: bool = False) -> tuple[QuantFact, ...]:
    rows = [
        fact("crypto.btc.return_20d", "market_bars", score="30"),
        fact("crypto.btc.return_60d", "market_bars", score="20"),
        fact("crypto.cycle.altcoin_season.index", "blockchaincenter", score="40", value="70"),
        fact("crypto.fear_greed.index", "alternative-fng", score="20", value="60"),
    ]
    if etf:
        rows.append(fact("crypto.etf.net_flow_usd", "farside", score="50"))
    if macro:
        rows.extend(
            (
                fact("macro.real_yield.10y_pct", "fred-real-yield", score="90"),
                fact("macro.usd_broad_index", "fred-usd", score="85"),
                fact("macro.fed_balance_sheet_change_4w", "fred-balance", score="100"),
                fact("macro.tga_change_4w", "fred-tga", score="-100"),
            )
        )
    return tuple(rows)


def test_crypto_profiles_use_exact_weights_without_changing_btc() -> None:
    assert pillar_weights("crypto", "ADA") == {
        "trend": Decimal("0.30"),
        "btc_trend": Decimal("0.25"),
        "altcoin_rotation": Decimal("0.20"),
        "macro": Decimal("0.15"),
        "broad_sentiment": Decimal("0.10"),
    }
    assert pillar_weights("crypto", "ETH") == {
        "trend": Decimal("0.25"),
        "btc_trend": Decimal("0.20"),
        "altcoin_rotation": Decimal("0.15"),
        "etf_flow": Decimal("0.25"),
        "macro": Decimal("0.10"),
        "broad_sentiment": Decimal("0.05"),
    }
    assert pillar_weights("crypto", "BTC") == {
        "trend": Decimal("0.40"),
        "fund_flow": Decimal("0.30"),
        "macro": Decimal("0.15"),
        "sentiment_onchain": Decimal("0.15"),
    }


def test_altcoin_coverage_reflects_optional_macro_and_etf_pillars() -> None:
    standard = build_quant_opinion(
        asset=candidate("ADA", market="crypto"),
        bars=bars(90, symbol="ADA"),
        specialized=alt_context_facts(),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    eth_with_etf = build_quant_opinion(
        asset=candidate("ETH", market="crypto"),
        bars=bars(90, symbol="ETH"),
        specialized=alt_context_facts(etf=True),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    eth_without_etf = build_quant_opinion(
        asset=candidate("ETH", market="crypto"),
        bars=bars(90, symbol="ETH"),
        specialized=alt_context_facts(),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    price_only = build_quant_opinion(
        asset=candidate("ADA", market="crypto"),
        bars=bars(90, symbol="ADA"),
        specialized=(),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert standard.data_coverage == Decimal("0.85")
    assert eth_with_etf.data_coverage == Decimal("0.90")
    assert eth_without_etf.data_coverage == Decimal("0.65")
    assert price_only.data_coverage == Decimal("0.30")
    assert "PILLAR_COVERAGE_MINIMUM_60" in price_only.gate.failed_gates


def test_altcoin_ledger_keeps_only_two_strongest_macro_inputs() -> None:
    opinion = build_quant_opinion(
        asset=candidate("ADA", market="crypto"),
        bars=bars(90, symbol="ADA"),
        specialized=alt_context_facts(macro=True),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    macro_codes = {
        row.metric_code for row in opinion.decision_inputs if row.pillar_code == "macro"
    }
    assert macro_codes == {"macro.real_yield.10y_pct", "macro.usd_broad_index"}
    assert len(opinion.decision_inputs) <= 12


def test_btc_context_uses_explainable_bounded_returns() -> None:
    context = build_btc_context_facts(bars(90, symbol="BTC"), as_of=NOW)

    assert tuple(row.metric_code for row in context) == (
        "crypto.btc.return_20d",
        "crypto.btc.return_60d",
    )
    assert all(row.signed_score is not None for row in context)
    assert all(
        Decimal("-100") <= row.signed_score <= Decimal("100")
        for row in context
        if row.signed_score is not None
    )
    assert all(row.normalization_method == "return_x400_bounded_v1" for row in context)
    assert all(row.source_family == "market_bars" for row in context)
    assert tuple(len(row.underlying_ids) for row in context) == (21, 61)


@pytest.mark.parametrize(
    ("value", "expected"),
    (("25", "-50"), ("50", "0"), ("75", "50")),
)
def test_altcoin_season_uses_centered_rotation_score(value: str, expected: str) -> None:
    opinion = build_quant_opinion(
        asset=candidate("ADA", market="crypto"),
        bars=bars(90, symbol="ADA"),
        specialized=(
            fact(
                "crypto.cycle.altcoin_season.index",
                "blockchaincenter-altcoin-season",
                score=None,
                value=value,
            ),
        ),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    rotation = next(
        row
        for row in opinion.decision_inputs
        if row.metric_code == "crypto.cycle.altcoin_season.index"
    )
    assert rotation.normalized_score == Decimal(expected)
    assert rotation.normalization_method == "altcoin_season_centered_v1"


def test_altcoin_profile_accepts_m2_as_quantified_macro_liquidity() -> None:
    opinion = build_quant_opinion(
        asset=candidate("ADA", market="crypto"),
        bars=bars(90, symbol="ADA"),
        specialized=(
            *alt_context_facts(),
            fact("macro.m2_change_4w", "fred", score="55", value="0.02"),
        ),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert any(
        row.metric_code == "macro.m2_change_4w" and row.pillar_code == "macro"
        for row in opinion.decision_inputs
    )


def test_altcoin_invalidations_reference_only_available_decision_inputs() -> None:
    eth = build_quant_opinion(
        asset=candidate("ETH", market="crypto"),
        bars=bars(90, symbol="ETH"),
        specialized=(
            fact("crypto.btc.return_20d", "market_bars", score="30"),
            fact("crypto.btc.return_60d", "market_bars", score="20"),
            fact(
                "crypto.cycle.altcoin_season.index",
                "blockchaincenter",
                score=None,
                value="80",
            ),
            fact("crypto.etf.net_flow_usd", "farside", score="40"),
            fact(
                "crypto.fear_greed.index",
                "alternative-fng",
                score=None,
                value="60",
            ),
        ),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    ada = build_quant_opinion(
        asset=candidate("ADA", market="crypto"),
        bars=bars(90, symbol="ADA"),
        specialized=tuple(
            row
            for row in eth.facts
            if row.metric_code
            in {
                "crypto.btc.return_20d",
                "crypto.btc.return_60d",
                "crypto.cycle.altcoin_season.index",
                "crypto.fear_greed.index",
            }
        ),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert "BTC_TREND_TURNS_NEGATIVE" in eth.invalidation_conditions
    assert "ALTCOIN_SEASON_BELOW_75" in eth.invalidation_conditions
    assert "ETH_ETF_FLOW_TURNS_NEGATIVE" in eth.invalidation_conditions
    assert all("ETF_FLOW" not in code for code in ada.invalidation_conditions)


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


def test_equity_and_gold_publish_capped_technical_quant_opinions_from_fresh_bars() -> None:
    combined_equity_bars = (
        *bars(220, symbol="FPT", start="100", step="2"),
        *bars(220, symbol="VNINDEX", start="100", step="1"),
    )
    fpt = build_quant_opinion(
        asset=candidate("FPT", market="stock_vn"),
        bars=combined_equity_bars,
        specialized=(),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    vnindex = build_quant_opinion(
        asset=candidate("VNINDEX", market="equity"),
        bars=combined_equity_bars,
        specialized=(),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    xau = build_quant_opinion(
        asset=candidate("XAU", market="gold"),
        bars=bars(220, symbol="XAU"),
        specialized=(),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert fpt.gate.passed is True
    assert fpt.data_coverage == Decimal("0.80")
    assert fpt.confidence == Decimal("70")
    assert {row.code for row in fpt.pillars} == {"trend", "relative_liquidity"}
    assert vnindex.gate.passed is True
    assert vnindex.data_coverage == Decimal("0.50")
    assert vnindex.confidence == Decimal("50.00")
    assert xau.gate.passed is True
    assert xau.data_coverage == Decimal("0.55")
    assert xau.confidence == Decimal("55.00")


def test_crypto_does_not_relax_to_a_single_source_technical_opinion() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC", market="crypto"),
        bars=bars(220, symbol="BTC"),
        specialized=(),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    assert opinion.gate.passed is False
    assert "SOURCE_FAMILIES_MINIMUM_2" in opinion.gate.failed_gates
    assert "PILLAR_COVERAGE_MINIMUM_60" in opinion.gate.failed_gates


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


def test_whale_exchange_pressure_is_a_btc_only_decision_input() -> None:
    whale = fact(
        "crypto.large_address.exchange_flow_pressure_btc",
        "bitinfocharts-top-addresses",
        score="80",
    )
    btc = build_quant_opinion(
        asset=candidate("BTC", market="crypto"),
        bars=bars(220, symbol="BTC"),
        specialized=(*supportive_crypto_facts(), whale),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    alt = build_quant_opinion(
        asset=candidate("ADA", market="crypto"),
        bars=bars(220, symbol="ADA"),
        specialized=(*alt_context_facts(), whale),
        as_of=NOW,
        risk_tolerance="moderate",
    )

    btc_whale = next(
        row
        for row in btc.decision_inputs
        if row.metric_code == "crypto.large_address.exchange_flow_pressure_btc"
    )
    assert btc_whale.pillar_code == "sentiment_onchain"
    assert btc_whale.input_weight == Decimal("0.10")
    assert all(
        row.metric_code != "crypto.large_address.exchange_flow_pressure_btc"
        for row in alt.decision_inputs
    )


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
