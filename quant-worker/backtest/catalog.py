from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class AssetFeed:
    symbol: str
    market: str
    canonical_key: str
    asset_name: str
    currency: str
    venue: str
    timezone_name: str
    maximum_leverage: Decimal
    provider_code: str
    provider_name: str
    provider_symbol: str
    terms_url: str
    client_provider: str
    upstream_provider: str
    naive_timezone: str


def vn_equity_feed(symbol: str, name: str, venue: str = "HOSE") -> AssetFeed:
    return AssetFeed(
        symbol=symbol,
        market="vn_equity",
        canonical_key=f"VN:{venue}:{symbol}",
        asset_name=name,
        currency="VND",
        venue=venue,
        timezone_name="Asia/Ho_Chi_Minh",
        maximum_leverage=Decimal("2"),
        provider_code="vnstock-vci-free",
        provider_name="Vnstock VCI Free",
        provider_symbol=symbol,
        terms_url="https://vnstocks.com/docs/vnstock",
        client_provider="vnstock",
        upstream_provider="vci",
        naive_timezone="Asia/Ho_Chi_Minh",
    )


FEEDS = {
    "FPT": vn_equity_feed("FPT", "FPT Corporation"),
    "VCB": vn_equity_feed(
        "VCB", "Joint Stock Commercial Bank for Foreign Trade of Vietnam"
    ),
    "HPG": vn_equity_feed("HPG", "Hoa Phat Group"),
    "VNM": vn_equity_feed("VNM", "Vietnam Dairy Products"),
    "MWG": vn_equity_feed("MWG", "Mobile World Investment Corporation"),
    "SSI": vn_equity_feed("SSI", "SSI Securities Corporation"),
    "VIC": vn_equity_feed("VIC", "Vingroup"),
    "BTC": AssetFeed(
        symbol="BTC",
        market="crypto_spot",
        canonical_key="CRYPTO:BINANCE:BTCUSDT",
        asset_name="Bitcoin / Tether",
        currency="USDT",
        venue="BINANCE",
        timezone_name="UTC",
        maximum_leverage=Decimal("1"),
        provider_code="binance-public",
        provider_name="Binance Public Spot",
        provider_symbol="BTCUSDT",
        terms_url="https://developers.binance.com/en/docs/products/spot/rest-api",
        client_provider="binance",
        upstream_provider="binance",
        naive_timezone="UTC",
    ),
    "XAU": AssetFeed(
        symbol="XAU",
        market="metal_spot",
        canonical_key="METAL:OTC:XAUUSD",
        asset_name="Gold Spot / US Dollar",
        currency="USD",
        venue="OTC",
        timezone_name="UTC",
        maximum_leverage=Decimal("1"),
        provider_code="msn-via-vnstock",
        provider_name="MSN via Vnstock",
        provider_symbol="XAUUSD",
        terms_url="https://vnstocks.com/docs/vnstock-data/market-layer-v3",
        client_provider="vnstock",
        upstream_provider="msn",
        naive_timezone="UTC",
    ),
}
