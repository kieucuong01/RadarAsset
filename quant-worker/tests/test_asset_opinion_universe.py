from dataclasses import FrozenInstanceError
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from smart_insights.asset_opinion_contracts import (
    AssetCandidate,
    AssetIdentity,
    MarketBar,
    QuantFact,
)
from smart_insights.asset_opinion_quant import (
    build_asset_universe,
    canonical_opinion_market,
    canonical_symbol,
)


def candidate(
    symbol: str,
    *,
    weight: str = "0",
    watchlist_rank: int = 0,
    market: str = "crypto",
) -> AssetCandidate:
    return AssetCandidate(
        symbol=symbol,
        name=symbol,
        market=market,
        portfolio_weight=Decimal(weight),
        watchlist_rank=watchlist_rank,
    )


def test_universe_prioritizes_portfolio_then_watchlist_then_representatives() -> None:
    portfolio = (
        candidate("ETH", weight="0.20"),
        candidate("BTC", weight="0.60"),
    )
    watchlist = (
        candidate("GOLD", watchlist_rank=1, market="gold"),
        candidate("SOL", watchlist_rank=2),
    )

    result = build_asset_universe(
        portfolio,
        watchlist,
        ("VNINDEX", "XAU", "BTC"),
        limit=5,
    )

    assert tuple(row.symbol for row in result.assets) == (
        "BTC",
        "ETH",
        "XAU",
        "SOL",
        "VNINDEX",
    )
    assert result.excluded_representatives == ()


def test_universe_caps_at_25_and_reports_excluded_representatives() -> None:
    portfolio = tuple(
        candidate(f"A{index:02d}", weight=str(Decimal("1") / Decimal("25")))
        for index in range(25)
    )

    result = build_asset_universe(
        portfolio,
        (),
        ("VNINDEX", "XAU", "BTC"),
        limit=25,
    )

    assert len(result.assets) == 25
    assert result.excluded_representatives == ("VNINDEX", "XAU", "BTC")


def test_universe_deduplicates_aliases_before_applying_the_limit() -> None:
    result = build_asset_universe(
        (candidate("BTCUSDT", weight="0.25"),),
        (
            candidate("BTC", watchlist_rank=1),
            candidate("XAUUSD", watchlist_rank=2, market="gold"),
        ),
        ("BTC", "XAU"),
        limit=4,
    )

    assert tuple(row.symbol for row in result.assets) == ("BTC", "XAU")
    assert result.assets[0].portfolio_weight == Decimal("0.25")
    assert canonical_symbol(" gold ") == "XAU"


def test_universe_rejects_an_unbounded_or_empty_limit() -> None:
    with pytest.raises(ValueError, match="between 1 and 25"):
        build_asset_universe((), (), (), limit=0)
    with pytest.raises(ValueError, match="between 1 and 25"):
        build_asset_universe((), (), (), limit=26)


def test_catalog_market_wins_over_missing_or_incorrect_signal_market() -> None:
    assert canonical_opinion_market(
        AssetIdentity("ETH", "Ethereum", "crypto_spot", "crypto"),
        symbol="ETH",
        signal_market=None,
    ) == "crypto"
    assert canonical_opinion_market(
        AssetIdentity("SOL", "Solana", "crypto_spot", "crypto"),
        symbol="SOL",
        signal_market="macro",
    ) == "crypto"
    assert canonical_opinion_market(
        AssetIdentity("XAU", "Gold Spot", "metal_spot", "commodity"),
        symbol="XAU",
        signal_market=None,
    ) == "gold"


def test_universe_excludes_stablecoins_before_applying_limit() -> None:
    result = build_asset_universe(
        (candidate("USDT", weight="0.60"), candidate("ETH", weight="0.40")),
        (
            candidate("USDC", watchlist_rank=1),
            candidate("ADA", watchlist_rank=2),
        ),
        ("BTC",),
        limit=3,
    )

    assert tuple(row.symbol for row in result.assets) == ("ETH", "ADA", "BTC")


def test_contracts_are_frozen_and_reject_invalid_market_data() -> None:
    asset = candidate("BTC", weight="0.25")
    with pytest.raises(FrozenInstanceError):
        asset.symbol = "ETH"  # type: ignore[misc]

    with pytest.raises(ValueError, match="timezone-aware"):
        MarketBar("bar", "BTC", datetime(2026, 8, 15), Decimal("100"), datetime(2026, 8, 15))
    with pytest.raises(ValueError, match="positive"):
        MarketBar(
            "bar",
            "BTC",
            datetime(2026, 8, 15, tzinfo=timezone.utc),
            Decimal("0"),
            datetime(2026, 8, 15, tzinfo=timezone.utc),
        )


def test_quant_fact_rejects_invalid_confidence_and_naive_timestamps() -> None:
    aware = datetime(2026, 8, 15, tzinfo=timezone.utc)
    values = dict(
        id="fact",
        metric_code="crypto.etf.net_flow_usd",
        value=Decimal("1"),
        unit="USD_MILLION",
        effective_at=aware,
        observed_at=aware,
        source_family="farside",
        source_code="farside",
        source_url="https://farside.co.uk",
        signed_score=Decimal("20"),
        confidence=Decimal("80"),
        fresh=True,
        critical=False,
        methodology_version="asset-opinion-facts-v1",
    )
    with pytest.raises(ValueError, match="between 0 and 100"):
        QuantFact(**{**values, "confidence": Decimal("101")})
    with pytest.raises(ValueError, match="timezone-aware"):
        QuantFact(**{**values, "effective_at": datetime(2026, 8, 15)})
