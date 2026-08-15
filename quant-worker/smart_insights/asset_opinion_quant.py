from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from decimal import Decimal
from math import sqrt
from statistics import pstdev

from .asset_opinion_contracts import (
    AssetCandidate,
    DataGateResult,
    MarketBar,
    PillarScore,
    QuantAssetOpinion,
    QuantFact,
    UniverseResult,
)


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

PILLAR_WEIGHTS = {
    "trend": Decimal("0.40"),
    "flow_liquidity": Decimal("0.20"),
    "macro": Decimal("0.15"),
    "relative_value": Decimal("0.10"),
    "sentiment_onchain": Decimal("0.15"),
}

PILLAR_PREFIXES = {
    "flow_liquidity": (
        "crypto.etf.",
        "crypto.coinshares.",
        "crypto.stablecoin.",
        "crypto.defi.",
        "gold.cftc.",
        "equity.liquidity.",
        "equity.foreign_flow.",
    ),
    "macro": ("macro.",),
    "relative_value": ("equity.valuation.", "gold.relative_value."),
    "sentiment_onchain": (
        "crypto.fear_greed.",
        "crypto.derivatives.",
        "crypto.onchain.",
        "crypto.network.",
        "crypto.large_address.",
    ),
}

CONCENTRATION_LIMITS = {
    "conservative": Decimal("0.15"),
    "moderate": Decimal("0.25"),
    "aggressive": Decimal("0.35"),
}

METHODOLOGY_VERSION = "asset-opinion-v1"

BENCHMARK_BY_MARKET = {
    "crypto": "BTC",
    "gold": "XAU",
    "equity": "VNINDEX",
    "stock_vn": "VNINDEX",
}


def canonical_symbol(symbol: str) -> str:
    normalized = symbol.strip().upper()
    if not normalized:
        raise ValueError("Asset symbol is required.")
    return ALIASES.get(normalized, normalized)


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


def _pillar_for(fact: QuantFact) -> str | None:
    if fact.source_family == "market_bars" and fact.metric_code.startswith("market."):
        return "trend"
    for pillar, prefixes in PILLAR_PREFIXES.items():
        if fact.metric_code.startswith(prefixes):
            return pillar
    return None


def _pillars(facts: tuple[QuantFact, ...]) -> tuple[PillarScore, ...]:
    output: list[PillarScore] = []
    for code, configured_weight in PILLAR_WEIGHTS.items():
        rows = tuple(
            row
            for row in facts
            if row.fresh and row.signed_score is not None and _pillar_for(row) == code
        )
        if not rows:
            continue
        output.append(
            PillarScore(
                code=code,
                score=_average(tuple(row.signed_score for row in rows if row.signed_score is not None)),
                configured_weight=configured_weight,
                confidence=_average(tuple(row.confidence for row in rows)),
                fact_ids=tuple(row.id for row in rows),
                series=tuple((row.effective_at.isoformat(), row.signed_score or Decimal("0")) for row in rows),
            )
        )
    return tuple(output)


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
    pillars = _pillars(facts)
    coverage = sum((row.configured_weight for row in pillars), Decimal("0"))
    source_families = tuple(sorted({row.source_family for row in facts if row.fresh}))
    failed: list[str] = []
    if len(closed_bars) < 60:
        failed.append("MINIMUM_60_DAILY_BARS")
    if len(facts) < 3:
        failed.append("NUMERIC_FACTS_MINIMUM_3")
    if len(source_families) < 2:
        failed.append("SOURCE_FAMILIES_MINIMUM_2")
    if any(row.critical and not row.fresh for row in facts):
        failed.append("CRITICAL_INPUT_STALE")
    if coverage < Decimal("0.60"):
        failed.append("PILLAR_COVERAGE_MINIMUM_60")
    gate = DataGateResult(not failed, tuple(failed), source_families, len(facts))

    quant_score: Decimal | None = None
    confidence = Decimal("0")
    stance = "INSUFFICIENT_DATA"
    if gate.passed:
        quant_score = (
            sum((row.score * row.configured_weight for row in pillars), Decimal("0")) / coverage
        ).quantize(Decimal("0.01"))
        confidence = sum(
            (row.confidence * row.configured_weight for row in pillars), Decimal("0")
        ).quantize(Decimal("0.01"))
        stance = _stance(quant_score)

    has_contradiction = any(row.fresh and row.contradicting for row in facts)
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
    )
