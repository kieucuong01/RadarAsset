from backtest.providers import ProviderInstrumentDescriptor
from sync_provider_instruments import select_provider_instruments


def test_catalog_sync_prefers_curated_non_crypto_symbols_over_binance_collisions() -> None:
    descriptors = [
        ProviderInstrumentDescriptor(
            provider_symbol="VICUSDT",
            canonical_symbol="VIC",
            name="VIC / Tether",
            market="crypto_spot",
            venue="BINANCE",
            currency="USDT",
        ),
        ProviderInstrumentDescriptor(
            provider_symbol="VIC",
            canonical_symbol="VIC",
            name="Vingroup",
            market="vn_equity",
            venue="HOSE",
            currency="VND",
        ),
        ProviderInstrumentDescriptor(
            provider_symbol="BTCUSDT",
            canonical_symbol="BTC",
            name="Bitcoin / Tether",
            market="crypto_spot",
            venue="BINANCE",
            currency="USDT",
        ),
    ]

    selected = select_provider_instruments(descriptors)

    assert [(item.canonical_symbol, item.market) for item in selected] == [
        ("BTC", "crypto_spot"),
        ("VIC", "vn_equity"),
    ]
