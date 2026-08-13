from datetime import datetime, timezone

from backtest.providers import ProviderInstrumentDescriptor
from sync_provider_instruments import (
    collect_provider_descriptors,
    complete_catalog_provider_codes,
    market_timeframe_stale_cutoffs,
    load_service_tenant,
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
    assert params[0:2] == ("demo@radarasset.local", "demo-workspace")
    assert params[-2:] == ("all", "all")
    assert "dukascopy-public" in query
    assert "NOT (provider.code = 'msn-via-vnstock'" not in query
    assert "active_raw.coverage_end IS NULL" in query
    assert "pg_advisory_xact_lock" in query
    assert "ON CONFLICT DO NOTHING" in query


def test_catalog_sync_preserves_stale_instruments_and_snapshots_listing_state() -> None:
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
    assert not any("DELETE FROM provider_instruments" in query for query in queries)
    assert any(
        "UPDATE provider_instruments" in query and "is_active = false" in query
        for query in queries
    )
    assert any("instrument_catalog_snapshots" in query for query in queries)
    assert any(
        "UPDATE market_ingestion_requests" in query
        and "instrument_inactive" in query
        for query in queries
    )
    assert any(
        "UPDATE data_providers" in query and "msn-via-vnstock" in query
        for query in queries
    )
    deactivation = next(
        (query, params)
        for query, params in connection.cursor_instance.queries
        if "UPDATE provider_instruments AS instrument" in query
    )
    assert "provider.code = ANY(%s)" in deactivation[0]
    assert deactivation[1] == (["binance-public"],)


def test_catalog_collection_isolates_one_provider_failure() -> None:
    crypto = ProviderInstrumentDescriptor(
        provider_symbol="BTCUSDT",
        canonical_symbol="BTC",
        name="Bitcoin / Tether",
        market="crypto_spot",
        venue="BINANCE",
        currency="USDT",
    )

    class FailedAdapter:
        def list_instruments(self):
            raise RuntimeError("upstream secret must not escape")

    class HealthyAdapter:
        def list_instruments(self):
            return [crypto]

    descriptors, failures = collect_provider_descriptors(
        (("vnstock-vci-free", FailedAdapter()), ("binance-public", HealthyAdapter()))
    )

    assert descriptors == [crypto]
    assert failures == ["vnstock-vci-free"]


def test_incomplete_catalog_cannot_deactivate_existing_provider_universe() -> None:
    descriptors = [
        ProviderInstrumentDescriptor(
            provider_symbol="FPT",
            canonical_symbol="FPT",
            name="FPT",
            market="vn_equity",
            venue="HOSE",
            currency="VND",
        )
    ]

    assert complete_catalog_provider_codes(descriptors) == set()


def test_bulk_queue_ignores_inactive_catalog_entries() -> None:
    connection = FakeConnection()

    queue_market_ingestion_requests(connection, command="daily")

    query, params = connection.cursor_instance.queries[0]
    assert "pi.is_active = true" in query
    assert params[0:2] == ("demo@radarasset.local", "demo-workspace")
    assert params[-2:] == ("1d", "1d")


def test_due_cutoffs_follow_closed_crypto_and_hose_sessions() -> None:
    now = datetime(2026, 8, 14, 9, 30, tzinfo=timezone.utc)

    cutoffs = market_timeframe_stale_cutoffs(now)

    assert cutoffs[("crypto_spot", "1h")] == datetime(
        2026, 8, 14, 6, 30, tzinfo=timezone.utc
    )
    assert cutoffs[("vn_equity", "1h")] == datetime(
        2026, 8, 14, 5, 30, tzinfo=timezone.utc
    )
    assert cutoffs[("vn_equity", "1d")] == datetime(
        2026, 8, 12, 5, 0, tzinfo=timezone.utc
    )


def test_due_cutoffs_use_previous_hose_session_on_market_holiday() -> None:
    now = datetime(2026, 9, 2, 12, 0, tzinfo=timezone.utc)

    cutoffs = market_timeframe_stale_cutoffs(now)

    assert cutoffs[("vn_equity", "1h")] == datetime(
        2026, 8, 31, 5, 30, tzinfo=timezone.utc
    )


def test_bulk_queue_excludes_unsupported_xau_hourly_identity() -> None:
    connection = FakeConnection()

    queue_market_ingestion_requests(
        connection,
        command="hourly",
        now=datetime(2026, 8, 14, 9, 30, tzinfo=timezone.utc),
    )

    query, _params = connection.cursor_instance.queries[0]
    assert "NOT (asset.market = 'metal_spot' AND timeframe.timeframe = '1h')" in query


def test_catalog_cli_uses_configured_service_tenant_for_scheduled_queue(monkeypatch) -> None:
    import inspect

    import sync_provider_instruments as module

    source = inspect.getsource(module.main)

    assert 'parser.add_argument("--env-file"' in source
    assert "load_service_tenant(env_file)" in source
    assert "load_database_url(env_file)" in source
    assert "organization_slug=organization_slug" in source
    assert "user_email=user_email" in source


def test_service_tenant_loads_from_env_file_when_process_env_is_missing(
    monkeypatch, tmp_path
) -> None:
    monkeypatch.delenv("QUANT_WORKER_ORGANIZATION_SLUG", raising=False)
    monkeypatch.delenv("QUANT_WORKER_USER_EMAIL", raising=False)
    env_file = tmp_path / ".env.local"
    env_file.write_text(
        'QUANT_WORKER_ORGANIZATION_SLUG="production-quant"\n'
        "QUANT_WORKER_USER_EMAIL=quant-worker@example.com\n",
        encoding="utf-8",
    )

    assert load_service_tenant(env_file) == (
        "production-quant",
        "quant-worker@example.com",
    )
