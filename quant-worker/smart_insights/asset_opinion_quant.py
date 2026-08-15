from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

from .asset_opinion_contracts import AssetCandidate, UniverseResult


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
