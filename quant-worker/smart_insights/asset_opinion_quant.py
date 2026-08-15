from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from decimal import Decimal
from math import sqrt
from statistics import pstdev

from .asset_opinion_contracts import (
    AssetCandidate,
    AssetIdentity,
    DataGateResult,
    DecisionInput,
    MarketBar,
    PillarScore,
    QuantAssetOpinion,
    QuantFact,
    UniverseResult,
)
from .asset_opinion_rules import InputRule, input_rule, pillar_weights


ALIASES = {
    "GOLD": "XAU",
    "XAUUSD": "XAU",
    "BTCUSD": "BTC",
    "BTCUSDT": "BTC",
}

REPRESENTATIVE_MARKETS = {
    "BTC": "crypto",
    "XAU": "gold",
    "VNINDEX": "equity",
}

CONCENTRATION_LIMITS = {
    "conservative": Decimal("0.15"),
    "moderate": Decimal("0.25"),
    "aggressive": Decimal("0.35"),
}

METHODOLOGY_VERSION = "asset-opinion-v2"

BENCHMARK_BY_MARKET = {
    "crypto": "BTC",
    "gold": "XAU",
    "equity": "VNINDEX",
    "stock_vn": "VNINDEX",
}

STABLECOIN_SYMBOLS = frozenset({"USDT", "USDC", "DAI", "FDUSD", "TUSD"})


def canonical_symbol(symbol: str) -> str:
    normalized = symbol.strip().upper()
    if not normalized:
        raise ValueError("Asset symbol is required.")
    return ALIASES.get(normalized, normalized)


def canonical_opinion_market(
    identity: AssetIdentity | None,
    *,
    symbol: str,
    signal_market: str | None,
) -> str:
    normalized = canonical_symbol(symbol)
    if identity is not None:
        if identity.market == "crypto_spot" or identity.asset_class.casefold() == "crypto":
            return "crypto"
        if identity.market == "vn_equity":
            return "stock_vn"
        if identity.market == "metal_spot" or normalized == "XAU":
            return "gold"
        if identity.market in {"equity", "index", "global_equity"}:
            return "equity"
    representative = REPRESENTATIVE_MARKETS.get(normalized)
    if representative is not None:
        return representative
    return signal_market if signal_market in {"crypto", "gold", "equity", "stock_vn"} else "other"


def _canonical_candidate(candidate: AssetCandidate) -> AssetCandidate:
    symbol = canonical_symbol(candidate.symbol)
    return candidate if candidate.symbol == symbol else replace(candidate, symbol=symbol)


def build_asset_universe(
    portfolio: tuple[AssetCandidate, ...],
    watchlist: tuple[AssetCandidate, ...],
    representatives: tuple[str, ...],
    *,
    limit: int = 25,
) -> UniverseResult:
    if not 1 <= limit <= 25:
        raise ValueError("Asset universe limit must be between 1 and 25.")

    ordered_portfolio = sorted(
        portfolio,
        key=lambda row: (-abs(row.portfolio_weight), canonical_symbol(row.symbol)),
    )
    ordered_watchlist = sorted(
        watchlist,
        key=lambda row: (row.watchlist_rank, canonical_symbol(row.symbol)),
    )
    representative_rows = tuple(
        AssetCandidate(
            symbol=canonical_symbol(symbol),
            name=canonical_symbol(symbol),
            market=REPRESENTATIVE_MARKETS.get(canonical_symbol(symbol), "other"),
            portfolio_weight=Decimal("0"),
            watchlist_rank=index,
        )
        for index, symbol in enumerate(representatives)
    )

    selected: list[AssetCandidate] = []
    seen: set[str] = set()
    for raw in (*ordered_portfolio, *ordered_watchlist, *representative_rows):
        candidate = _canonical_candidate(raw)
        if candidate.symbol in STABLECOIN_SYMBOLS:
            continue
        if candidate.symbol in seen:
            continue
        seen.add(candidate.symbol)
        if len(selected) < limit:
            selected.append(candidate)

    selected_symbols = {row.symbol for row in selected}
    excluded = tuple(
        symbol
        for symbol in dict.fromkeys(canonical_symbol(value) for value in representatives)
        if symbol not in selected_symbols
    )
    return UniverseResult(tuple(selected), excluded)


def _bounded(value: Decimal) -> Decimal:
    return max(Decimal("-100"), min(Decimal("100"), value))


def _average(values: tuple[Decimal, ...]) -> Decimal:
    return sum(values, Decimal("0")) / Decimal(len(values))


def _percentile_rank(values: tuple[Decimal, ...], current: Decimal) -> Decimal:
    if not values:
        return Decimal("0")
    return (
        Decimal(sum(1 for value in values if value <= current)) / Decimal(len(values))
    ).quantize(Decimal("0.0001"))


def _derived_fact(
    *,
    asset: AssetCandidate,
    metric_code: str,
    value: Decimal,
    score: Decimal | None,
    latest: MarketBar,
    underlying: tuple[MarketBar, ...],
    fresh: bool,
) -> QuantFact:
    return QuantFact(
        id=f"derived:{asset.symbol}:{metric_code}:{latest.ts.isoformat()}",
        metric_code=metric_code,
        value=value,
        unit="RATIO",
        effective_at=latest.ts,
        observed_at=latest.observed_at,
        source_family="market_bars",
        source_code="radarasset-market-data",
        source_url="https://radarasset.app/methodology/asset-opinion-facts-v1",
        signed_score=None if score is None else _bounded(score),
        confidence=Decimal("100") if fresh else Decimal("0"),
        fresh=fresh,
        critical=True,
        methodology_version="asset-opinion-facts-v1",
        underlying_ids=tuple(row.id for row in underlying),
    )


def _common_facts(
    asset: AssetCandidate,
    bars: tuple[MarketBar, ...],
    *,
    as_of: datetime,
) -> tuple[tuple[MarketBar, ...], tuple[QuantFact, ...]]:
    closed = tuple(
        sorted(
            (
                row
                for row in bars
                if canonical_symbol(row.symbol) == asset.symbol
                and row.ts <= as_of
                and row.observed_at <= as_of
            ),
            key=lambda row: (row.ts, row.observed_at, row.id),
        )
    )
    if not closed:
        return (), ()
    latest = closed[-1]
    maximum_age_hours = Decimal("36") if asset.market == "crypto" else Decimal("96")
    age_hours = Decimal(str((as_of - latest.observed_at).total_seconds() / 3600))
    bar_fresh = Decimal("0") <= age_hours <= maximum_age_hours
    facts: list[QuantFact] = []
    for days in (1, 5, 20, 60):
        if len(closed) <= days:
            continue
        window = closed[-days - 1 :]
        value = window[-1].close / window[0].close - Decimal("1")
        facts.append(
            _derived_fact(
                asset=asset,
                metric_code=f"market.return_{days}d",
                value=value,
                score=value * Decimal("400"),
                latest=latest,
                underlying=window,
                fresh=bar_fresh,
            )
        )
    for days in (20, 50, 200):
        if len(closed) < days:
            continue
        window = closed[-days:]
        mean = _average(tuple(row.close for row in window))
        value = latest.close / mean - Decimal("1")
        facts.append(
            _derived_fact(
                asset=asset,
                metric_code=f"market.ma_{days}_position",
                value=value,
                score=value * Decimal("400"),
                latest=latest,
                underlying=window,
                fresh=bar_fresh,
            )
        )
    if len(closed) >= 21:
        window = closed[-21:]
        daily = [
            float(window[index].close / window[index - 1].close - Decimal("1"))
            for index in range(1, len(window))
        ]
        volatility = Decimal(str(pstdev(daily) * sqrt(252)))
        facts.append(
            _derived_fact(
                asset=asset,
                metric_code="market.realized_volatility_20d",
                value=volatility,
                score=-volatility * Decimal("100"),
                latest=latest,
                underlying=window,
                fresh=bar_fresh,
            )
        )
        rolling_volatility: list[Decimal] = []
        for end in range(20, len(closed)):
            sample = closed[end - 20 : end + 1]
            returns = [
                float(sample[index].close / sample[index - 1].close - Decimal("1"))
                for index in range(1, len(sample))
            ]
            rolling_volatility.append(Decimal(str(pstdev(returns) * sqrt(252))))
        facts.append(
            _derived_fact(
                asset=asset,
                metric_code="market.realized_volatility_20d_percentile",
                value=_percentile_rank(tuple(rolling_volatility), volatility),
                score=None,
                latest=latest,
                underlying=closed,
                fresh=bar_fresh,
            )
        )
    maximum = max(row.close for row in closed)
    drawdown = latest.close / maximum - Decimal("1")
    facts.append(
        _derived_fact(
            asset=asset,
            metric_code="market.current_drawdown",
            value=drawdown,
            score=drawdown * Decimal("200"),
            latest=latest,
            underlying=closed,
            fresh=bar_fresh,
        )
    )
    running_max = closed[0].close
    drawdown_history: list[Decimal] = []
    for row in closed:
        running_max = max(running_max, row.close)
        drawdown_history.append(abs(row.close / running_max - Decimal("1")))
    facts.append(
        _derived_fact(
            asset=asset,
            metric_code="market.drawdown_percentile",
            value=_percentile_rank(tuple(drawdown_history), abs(drawdown)),
            score=None,
            latest=latest,
            underlying=closed,
            fresh=bar_fresh,
        )
    )
    return closed, tuple(facts)


def build_btc_context_facts(
    bars: tuple[MarketBar, ...], *, as_of: datetime
) -> tuple[QuantFact, ...]:
    benchmark = AssetCandidate(
        symbol="BTC",
        name="Bitcoin",
        market="crypto",
        portfolio_weight=Decimal("0"),
        watchlist_rank=0,
    )
    _closed, common = _common_facts(benchmark, bars, as_of=as_of)
    by_code = {row.metric_code: row for row in common}
    output: list[QuantFact] = []
    for days in (20, 60):
        source = by_code.get(f"market.return_{days}d")
        if source is None:
            continue
        metric_code = f"crypto.btc.return_{days}d"
        output.append(
            replace(
                source,
                id=f"derived:BTC:{metric_code}:{source.effective_at.isoformat()}",
                metric_code=metric_code,
                normalization_method="return_x400_bounded_v1",
            )
        )
    return tuple(output)


def _relative_strength_fact(
    asset: AssetCandidate,
    asset_bars: tuple[MarketBar, ...],
    all_bars: tuple[MarketBar, ...],
    *,
    as_of: datetime,
) -> QuantFact | None:
    benchmark = BENCHMARK_BY_MARKET.get(asset.market)
    if benchmark is None or benchmark == asset.symbol or len(asset_bars) < 21:
        return None
    benchmark_bars = tuple(
        sorted(
            (
                row
                for row in all_bars
                if canonical_symbol(row.symbol) == benchmark
                and row.ts <= as_of
                and row.observed_at <= as_of
            ),
            key=lambda row: (row.ts, row.observed_at, row.id),
        )
    )
    if len(benchmark_bars) < 21:
        return None
    asset_window = asset_bars[-21:]
    benchmark_window = benchmark_bars[-21:]
    asset_return = asset_window[-1].close / asset_window[0].close - Decimal("1")
    benchmark_return = (
        benchmark_window[-1].close / benchmark_window[0].close - Decimal("1")
    )
    relative = asset_return - benchmark_return
    maximum_age_hours = Decimal("36") if asset.market == "crypto" else Decimal("96")
    age_hours = Decimal(str((as_of - asset_window[-1].observed_at).total_seconds() / 3600))
    return _derived_fact(
        asset=asset,
        metric_code="market.relative_strength_20d",
        value=relative,
        score=relative * Decimal("400"),
        latest=asset_window[-1],
        underlying=(*asset_window, *benchmark_window),
        fresh=Decimal("0") <= age_hours <= maximum_age_hours,
    )


def _fact_score(fact: QuantFact) -> tuple[Decimal, str] | None:
    if fact.metric_code == "crypto.cycle.altcoin_season.index":
        return (
            _bounded((fact.value - Decimal("50")) * Decimal("2")),
            "altcoin_season_centered_v1",
        )
    if fact.signed_score is not None:
        return fact.signed_score, fact.normalization_method
    if fact.metric_code == "crypto.fear_greed.index":
        score = _bounded((fact.value - Decimal("50")) * Decimal("2"))
        return score, "fear_greed_centered_v1"
    return None


def _lookback(metric_code: str) -> str | None:
    if metric_code == "crypto.etf.net_flow_usd":
        return "90D"
    if metric_code == "crypto.coinshares.net_flow_usd":
        return "52W"
    return None


def _decision_ledger(
    market: str, symbol: str, facts: tuple[QuantFact, ...]
) -> tuple[tuple[PillarScore, ...], tuple[DecisionInput, ...]]:
    configured_weights = pillar_weights(market, symbol)
    candidates: list[tuple[QuantFact, InputRule, Decimal, str]] = []
    for fact in facts:
        if not fact.fresh:
            continue
        rule = input_rule(market, symbol, fact.metric_code)
        scored = _fact_score(fact)
        if rule is None or scored is None:
            continue
        candidates.append((fact, rule, scored[0], scored[1]))

    detailed_macro_exists = any(
        fact.metric_code.startswith("macro.")
        and fact.metric_code != "macro.regime.score"
        for fact, _rule, _score_value, _method in candidates
    )
    if detailed_macro_exists:
        candidates = [
            row for row in candidates if row[0].metric_code != "macro.regime.score"
        ]

    macro_rows = sorted(
        (row for row in candidates if row[1].pillar_code == "macro"),
        key=lambda row: (
            -abs(row[2] * row[1].input_weight),
            row[0].metric_code,
            row[0].id,
        ),
    )[:2]
    allowed_macro_ids = {row[0].id for row in macro_rows}
    candidates = [
        row
        for row in candidates
        if row[1].pillar_code != "macro" or row[0].id in allowed_macro_ids
    ]

    candidates.sort(
        key=lambda row: (
            -configured_weights.get(row[1].pillar_code, Decimal("0")),
            -row[1].input_weight,
            -abs(row[2]),
            row[0].metric_code,
            row[0].id,
        )
    )
    candidates = candidates[:12]

    pillars: list[PillarScore] = []
    decision_inputs: list[DecisionInput] = []
    for pillar_code, configured_weight in configured_weights.items():
        rows = tuple(row for row in candidates if row[1].pillar_code == pillar_code)
        if not rows:
            continue
        available_weight = sum((row[1].input_weight for row in rows), Decimal("0"))
        if available_weight <= 0:
            continue
        pillar_score = (
            sum((score * rule.input_weight for _fact, rule, score, _method in rows), Decimal("0"))
            / available_weight
        ).quantize(Decimal("0.01"))
        pillar_contribution = (pillar_score * configured_weight).quantize(
            Decimal("0.0001")
        )
        pillars.append(
            PillarScore(
                code=pillar_code,
                score=pillar_score,
                configured_weight=configured_weight,
                confidence=(
                    sum(
                        (fact.confidence * rule.input_weight for fact, rule, _score, _method in rows),
                        Decimal("0"),
                    )
                    / available_weight
                ).quantize(Decimal("0.01")),
                fact_ids=tuple(fact.id for fact, _rule, _score, _method in rows),
                series=tuple(
                    (fact.effective_at.isoformat(), score)
                    for fact, _rule, score, _method in rows
                ),
                available_input_weight=available_weight,
                contribution=pillar_contribution,
            )
        )
        for fact, rule, score, method in rows:
            weighted_score = (score * rule.input_weight).quantize(Decimal("0.0001"))
            contribution = (
                weighted_score / available_weight * configured_weight
            ).quantize(Decimal("0.0001"))
            decision_inputs.append(
                DecisionInput(
                    fact_id=fact.id,
                    metric_code=fact.metric_code,
                    pillar_code=pillar_code,
                    raw_value=fact.value,
                    unit=fact.unit,
                    normalized_score=score,
                    input_weight=rule.input_weight,
                    weighted_score=weighted_score,
                    pillar_weight=configured_weight,
                    contribution=contribution,
                    normalization_method=method,
                    percentile=fact.percentile,
                    lookback=_lookback(fact.metric_code),
                )
            )
    decision_inputs.sort(key=lambda row: (-abs(row.contribution), row.fact_id))
    return tuple(pillars), tuple(decision_inputs)


def _stance(score: Decimal) -> str:
    if score <= Decimal("-40"):
        return "NEGATIVE"
    if score <= Decimal("-15"):
        return "CAUTIOUS"
    if score < Decimal("15"):
        return "NEUTRAL"
    if score < Decimal("40"):
        return "CONSTRUCTIVE"
    return "POSITIVE"


def _invalidation_conditions(
    stance: str,
    symbol: str,
    decision_inputs: tuple[DecisionInput, ...],
) -> tuple[str, ...]:
    conditions: list[str] = []
    if stance == "POSITIVE":
        conditions.append("ASSET_SCORE_BELOW_40")
    elif stance == "CONSTRUCTIVE":
        conditions.append("ASSET_SCORE_BELOW_15")
    elif stance == "CAUTIOUS":
        conditions.append("ASSET_SCORE_ABOVE_NEGATIVE_15")
    elif stance == "NEGATIVE":
        conditions.append("ASSET_SCORE_ABOVE_NEGATIVE_40")
    elif stance == "NEUTRAL":
        conditions.append("ASSET_SCORE_OUTSIDE_NEGATIVE_15_TO_15")

    btc_trend = tuple(
        row for row in decision_inputs if row.metric_code.startswith("crypto.btc.return_")
    )
    if btc_trend:
        average = sum(
            (row.normalized_score for row in btc_trend), Decimal("0")
        ) / Decimal(len(btc_trend))
        conditions.append(
            "BTC_TREND_TURNS_NEGATIVE"
            if average >= 0
            else "BTC_TREND_TURNS_POSITIVE"
        )

    rotation = next(
        (
            row
            for row in decision_inputs
            if row.metric_code == "crypto.cycle.altcoin_season.index"
        ),
        None,
    )
    if rotation is not None:
        if rotation.raw_value >= Decimal("75"):
            conditions.append("ALTCOIN_SEASON_BELOW_75")
        elif rotation.raw_value <= Decimal("25"):
            conditions.append("ALTCOIN_SEASON_ABOVE_25")
        else:
            conditions.append("ALTCOIN_SEASON_ABOVE_75")

    normalized_symbol = canonical_symbol(symbol)
    if normalized_symbol in {"ETH", "SOL"}:
        etf = next(
            (
                row
                for row in decision_inputs
                if row.metric_code == "crypto.etf.net_flow_usd"
            ),
            None,
        )
        if etf is not None:
            direction = "NEGATIVE" if etf.normalized_score >= 0 else "POSITIVE"
            conditions.append(f"{normalized_symbol}_ETF_FLOW_TURNS_{direction}")

    return tuple(dict.fromkeys(conditions))


def build_quant_opinion(
    *,
    asset: AssetCandidate,
    bars: tuple[MarketBar, ...],
    specialized: tuple[QuantFact, ...],
    as_of: datetime,
    risk_tolerance: str,
) -> QuantAssetOpinion:
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware.")
    if risk_tolerance not in CONCENTRATION_LIMITS:
        raise ValueError("risk_tolerance is not supported.")

    closed_bars, common = _common_facts(asset, bars, as_of=as_of)
    relative_strength = _relative_strength_fact(asset, closed_bars, bars, as_of=as_of)
    if relative_strength is not None:
        common = (*common, relative_strength)
    permitted_specialized = tuple(
        row
        for row in specialized
        if row.effective_at <= as_of
        and row.observed_at <= as_of
        and "kronos" not in row.metric_code.casefold()
        and "kronos" not in row.methodology_version.casefold()
    )
    facts = tuple(sorted((*common, *permitted_specialized), key=lambda row: (row.metric_code, row.id)))
    pillars, decision_inputs = _decision_ledger(asset.market, asset.symbol, facts)
    coverage = sum((row.configured_weight for row in pillars), Decimal("0"))
    decision_fact_ids = {row.fact_id for row in decision_inputs}
    source_families = tuple(
        sorted(
            {
                row.source_family
                for row in facts
                if row.fresh and row.id in decision_fact_ids
            }
        )
    )
    failed: list[str] = []
    if len(closed_bars) < 60:
        failed.append("MINIMUM_60_DAILY_BARS")
    if len(decision_inputs) < 3:
        failed.append("NUMERIC_FACTS_MINIMUM_3")
    if len(source_families) < 2:
        failed.append("SOURCE_FAMILIES_MINIMUM_2")
    if any(row.critical and not row.fresh for row in facts):
        failed.append("CRITICAL_INPUT_STALE")
    if coverage < Decimal("0.60"):
        failed.append("PILLAR_COVERAGE_MINIMUM_60")
    gate = DataGateResult(
        not failed, tuple(failed), source_families, len(decision_inputs)
    )

    quant_score: Decimal | None = None
    confidence = Decimal("0")
    stance = "INSUFFICIENT_DATA"
    total_contribution = sum(
        (row.contribution for row in pillars), Decimal("0")
    ).quantize(Decimal("0.0001"))
    if gate.passed:
        quant_score = (total_contribution / coverage).quantize(Decimal("0.01"))
        confidence = sum(
            (row.confidence * row.configured_weight for row in pillars), Decimal("0")
        ).quantize(Decimal("0.01"))
        stance = _stance(quant_score)

    facts_by_id = {row.id: row for row in facts}
    positive_direction = quant_score is None or quant_score >= 0
    contradicting_rows = tuple(
        row
        for row in decision_inputs
        if facts_by_id[row.fact_id].contradicting
        or (row.contribution < 0 if positive_direction else row.contribution > 0)
    )
    contradicting_fact_ids = tuple(row.fact_id for row in contradicting_rows[:3])
    all_contradicting_fact_ids = {row.fact_id for row in contradicting_rows}
    supporting_rows = tuple(
        row
        for row in decision_inputs
        if row.fact_id not in all_contradicting_fact_ids
        and (row.contribution > 0 if positive_direction else row.contribution < 0)
    )
    supporting_fact_ids = tuple(row.fact_id for row in supporting_rows[:5])
    has_contradiction = any(
        row.fresh and row.contradicting and row.id in decision_fact_ids for row in facts
    )
    if not gate.passed:
        action = "NO_ACTION_INSUFFICIENT_DATA"
    elif abs(asset.portfolio_weight) > CONCENTRATION_LIMITS[risk_tolerance]:
        action = "REVIEW_REDUCE_RISK"
    elif has_contradiction:
        action = "WAIT_CONFIRMATION"
    elif stance in {"CONSTRUCTIVE", "POSITIVE"}:
        action = "REVIEW_INCREASE"
    else:
        action = "HOLD"

    unrealized_return = None
    if closed_bars and asset.average_cost is not None:
        unrealized_return = (
            closed_bars[-1].close / asset.average_cost - Decimal("1")
        ).quantize(Decimal("0.0001"))

    freshness = (
        "stale"
        if "CRITICAL_INPUT_STALE" in gate.failed_gates
        else "fresh" if gate.passed else "unavailable"
    )
    return QuantAssetOpinion(
        asset=asset,
        stance=stance,
        quant_score=quant_score,
        confidence=confidence,
        data_coverage=coverage,
        gate=gate,
        pillars=pillars,
        facts=facts,
        personalized_action=action,
        horizon="WEEKS_1_4",
        freshness=freshness,
        methodology_version=METHODOLOGY_VERSION,
        unrealized_return=unrealized_return,
        decision_inputs=decision_inputs,
        total_contribution=total_contribution,
        supporting_fact_ids=supporting_fact_ids,
        contradicting_fact_ids=contradicting_fact_ids,
        invalidation_conditions=_invalidation_conditions(
            stance, asset.symbol, decision_inputs
        ),
    )
