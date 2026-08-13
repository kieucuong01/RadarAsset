from backtest.providers import ProviderInstrumentDescriptor
from sync_provider_instruments import (
    queue_market_ingestion_requests,
    select_provider_instruments,
    sync_provider_instruments,
)


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


class FakeCursor:
    def __init__(self) -> None:
        self.queries: list[tuple[str, tuple[object, ...]]] = []
        self.rowcount = 0

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.queries.append((query, params))
        self.rowcount = 7

    def fetchone(self) -> tuple[str]:
        return ("00000000-0000-4000-8000-000000000001",)

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *_args: object) -> None:
        return None


class FakeTransaction:
    def __enter__(self) -> "FakeTransaction":
        return self

    def __exit__(self, *_args: object) -> None:
        return None


class FakeConnection:
    def __init__(self) -> None:
        self.cursor_instance = FakeCursor()

    def transaction(self) -> FakeTransaction:
        return FakeTransaction()

    def cursor(self) -> FakeCursor:
        return self.cursor_instance


def test_bulk_queue_selects_supported_timeframes_for_all_synced_instruments() -> None:
    connection = FakeConnection()

    count = queue_market_ingestion_requests(connection, command="all")

    assert count == 7
    query, params = connection.cursor_instance.queries[0]
    assert "provider_instruments" in query
    assert "market_ingestion_requests" in query
    assert params == ("demo@radarasset.local", "demo-workspace", "all", "all")
    assert "dukascopy-public" in query
    assert "NOT (provider.code = 'msn-via-vnstock'" not in query


def test_catalog_sync_prunes_stale_approved_provider_instruments() -> None:
    connection = FakeConnection()
    descriptor = ProviderInstrumentDescriptor(
        provider_symbol="BTCUSDT",
        canonical_symbol="BTC",
        name="Bitcoin / Tether",
        market="crypto_spot",
        venue="BINANCE",
        currency="USDT",
    )

    sync_provider_instruments(connection, [descriptor])

    queries = [query for query, _params in connection.cursor_instance.queries]
    assert any("DELETE FROM market_ingestion_requests" in query for query in queries)
    assert any("DELETE FROM provider_instruments" in query for query in queries)
    assert any("jsonb_to_recordset" in query for query in queries)
    assert any(
        "UPDATE data_providers" in query and "msn-via-vnstock" in query
        for query in queries
    )
