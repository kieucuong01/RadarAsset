from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import pytest

from backtest.catalog import FEEDS
from ingest_market_data import provider_for_code
from backtest.providers import (
    BinanceSpotAdapter,
    CcxtSpotAdapter,
    DukascopyXauAdapter,
    FallbackMarketDataProvider,
    HttpJsonResponse,
    ProviderInstrumentDescriptor,
    ProviderUnavailableError,
    VnstockAdapter,
    _load_vnstock_market,
)


class FakeDukascopyFrame:
    def to_dict(self, orient: str) -> list[dict[str, Any]]:
        assert orient == "records"
        return [
            {
                "timestamp": utc(2026, 8, 10),
                "open": 2400,
                "high": 2410,
                "low": 2390,
                "close": 2405,
                "volume": 12.5,
            }
        ]


class FailingProvider:
    def fetch(self, **_kwargs: Any) -> list[Any]:
        raise ProviderUnavailableError("provider_unavailable", "primary failed")


class FakeCcxtExchange:
    id = "kraken"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, int, int]] = []

    def load_markets(self) -> None:
        return None

    def fetch_ohlcv(self, symbol: str, timeframe: str, since: int, limit: int) -> list[list[Any]]:
        self.calls.append((symbol, timeframe, since, limit))
        if len(self.calls) > 1:
            return []
        return [[since, 100, 102, 99, 101, 12.5]]


def test_ccxt_fallback_is_used_only_after_primary_failure() -> None:
    exchange = FakeCcxtExchange()
    fallback = CcxtSpotAdapter(exchange=exchange, max_pages=2, max_rows=100)
    provider = FallbackMarketDataProvider(FailingProvider(), fallback)

    rows = provider.fetch(
        symbol="BTCUSDT",
        asset="BTC",
        timeframe="1h",
        start=utc(2025, 1, 1),
        end=utc(2025, 1, 1, 2),
        now=utc(2025, 1, 1, 3),
    )

    assert len(rows) == 1
    assert rows[0].source == "ccxt:kraken"
    assert exchange.calls[0][0] == "BTC/USD"


def utc(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def kline(open_time_ms: int) -> list[Any]:
    return [
        open_time_ms,
        "42000.1",
        "42500.2",
        "41900.3",
        "42400.4",
        "123.45",
        open_time_ms + 3_599_999,
        "5200000.00",
        1234,
        "60.00",
        "2500000.00",
        "0",
    ]


class SequenceTransport:
    def __init__(self, responses: list[HttpJsonResponse | Exception]) -> None:
        self.responses = list(responses)
        self.urls: list[str] = []

    def get_json(self, url: str, *, timeout_seconds: float) -> HttpJsonResponse:
        self.urls.append(url)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class FakeFrame:
    def __init__(self, records: list[dict[str, Any]]) -> None:
        self.records = records

    def to_dict(self, orient: str) -> list[dict[str, Any]]:
        assert orient == "records"
        return self.records


class FakeListing:
    def __init__(self, records: list[dict[str, Any]]) -> None:
        self.records = records

    def all_symbols(self) -> FakeFrame:
        return FakeFrame(self.records)


class FakeInstrument:
    def __init__(
        self,
        records: list[dict[str, Any]],
        error: Exception | None = None,
    ) -> None:
        self.records = records
        self.error = error
        self.calls: list[Mapping[str, str]] = []

    def ohlcv(self, **kwargs: str) -> FakeFrame:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return FakeFrame(self.records)


class FakeMarket:
    def __init__(
        self,
        records: list[dict[str, Any]],
        error: Exception | None = None,
    ) -> None:
        self.instrument = FakeInstrument(records, error)
        self.equity_calls: list[tuple[str, str]] = []
        self.index_calls: list[str] = []
        self.commodity_calls: list[str] = []

    def equity(self, symbol: str, *, source: str) -> FakeInstrument:
        self.equity_calls.append((symbol, source))
        return self.instrument

    def commodity(self, symbol: str) -> FakeInstrument:
        self.commodity_calls.append(symbol)
        return self.instrument

    def index(self, symbol: str) -> FakeInstrument:
        self.index_calls.append(symbol)
        return self.instrument


def test_binance_adapter_maps_the_complete_public_kline_shape() -> None:
    rows = BinanceSpotAdapter.parse_klines([kline(1_704_067_200_000)], asset="BTC", timeframe="1h")

    assert len(rows) == 1
    assert rows[0].timestamp == utc(2024, 1, 1)
    assert (rows[0].open, rows[0].high, rows[0].low, rows[0].close) == (
        Decimal("42000.1"),
        Decimal("42500.2"),
        Decimal("41900.3"),
        Decimal("42400.4"),
    )
    assert rows[0].volume == Decimal("123.45")
    assert rows[0].source == "binance-public-spot"


def test_binance_paginates_and_drops_the_open_bar() -> None:
    transport = SequenceTransport(
        [
            HttpJsonResponse(200, {}, [kline(0), kline(3_600_000)]),
            HttpJsonResponse(200, {}, [kline(7_200_000)]),
        ]
    )

    rows = BinanceSpotAdapter(transport=transport, max_pages=3).fetch(
        symbol="BTCUSDT",
        asset="BTC",
        timeframe="1h",
        start=utc(1970, 1, 1),
        end=utc(1970, 1, 1, 3),
        now=utc(1970, 1, 1, 2, 30),
    )

    assert [row.timestamp.hour for row in rows] == [0, 1]
    assert len(transport.urls) == 2
    assert "data-api.binance.vision/api/v3/klines" in transport.urls[0]


def test_binance_honors_retry_after_before_success() -> None:
    sleeps: list[float] = []
    transport = SequenceTransport(
        [
            HttpJsonResponse(429, {"Retry-After": "2"}, None),
            HttpJsonResponse(200, {}, [kline(0)]),
        ]
    )

    rows = BinanceSpotAdapter(
        transport=transport,
        sleep=sleeps.append,
        jitter=lambda: 0,
    ).fetch(
        symbol="BTCUSDT",
        asset="BTC",
        timeframe="1h",
        start=utc(1970, 1, 1),
        end=utc(1970, 1, 1, 1),
        now=utc(1970, 1, 1, 2),
    )

    assert len(rows) == 1
    assert sleeps == [2.0]


def test_binance_rejects_a_non_monotonic_page() -> None:
    transport = SequenceTransport(
        [HttpJsonResponse(200, {}, [kline(3_600_000), kline(0)])]
    )

    with pytest.raises(ProviderUnavailableError) as raised:
        BinanceSpotAdapter(transport=transport).fetch(
            symbol="BTCUSDT",
            asset="BTC",
            timeframe="1h",
            start=utc(1970, 1, 1),
            end=utc(1970, 1, 1, 2),
            now=utc(1970, 1, 1, 3),
        )

    assert raised.value.code == "invalid_response"


def test_binance_stops_after_three_transient_failures() -> None:
    sleeps: list[float] = []
    transport = SequenceTransport(
        [
            HttpJsonResponse(503, {}, None),
            HttpJsonResponse(503, {}, None),
            HttpJsonResponse(503, {}, None),
        ]
    )

    with pytest.raises(ProviderUnavailableError) as raised:
        BinanceSpotAdapter(
            transport=transport,
            sleep=sleeps.append,
            jitter=lambda: 0,
        ).fetch(
            symbol="BTCUSDT",
            asset="BTC",
            timeframe="1h",
            start=utc(1970, 1, 1),
            end=utc(1970, 1, 1, 1),
            now=utc(1970, 1, 1, 2),
        )

    assert raised.value.code == "provider_unavailable"
    assert len(transport.urls) == 3
    assert sleeps == [1.0, 2.0]


def test_binance_enforces_the_page_limit() -> None:
    transport = SequenceTransport([HttpJsonResponse(200, {}, [kline(0)])])

    with pytest.raises(ProviderUnavailableError) as raised:
        BinanceSpotAdapter(transport=transport, max_pages=1).fetch(
            symbol="BTCUSDT",
            asset="BTC",
            timeframe="1h",
            start=utc(1970, 1, 1),
            end=utc(1970, 1, 1, 2),
            now=utc(1970, 1, 1, 3),
        )

    assert raised.value.code == "response_limit"


def test_binance_rejects_redirect_responses() -> None:
    transport = SequenceTransport(
        [HttpJsonResponse(302, {"Location": "https://example.invalid"}, None)]
    )

    with pytest.raises(ProviderUnavailableError) as raised:
        BinanceSpotAdapter(transport=transport).fetch(
            symbol="BTCUSDT",
            asset="BTC",
            timeframe="1h",
            start=utc(1970, 1, 1),
            end=utc(1970, 1, 1, 1),
            now=utc(1970, 1, 1, 2),
        )

    assert raised.value.code == "provider_rejected"


def test_vnstock_adapter_normalizes_vietnam_time_to_utc() -> None:
    records = [
        {
            "time": "2024-01-02T09:00:00",
            "open": 82.1,
            "high": 83.5,
            "low": 81.9,
            "close": 83.2,
            "volume": 1_230_000,
        }
    ]

    rows = VnstockAdapter.parse_records(
        records,
        asset="FPT",
        timeframe="1h",
        source="vnstock-vci-free",
        naive_timezone="Asia/Ho_Chi_Minh",
    )

    assert rows[0].timestamp == utc(2024, 1, 2, 2)
    assert rows[0].close == Decimal("83.2")
    assert rows[0].volume == Decimal("1230000")
    assert rows[0].source == "vnstock-vci-free"


def test_vnstock_import_suppresses_vendor_agent_environment_setup(
    monkeypatch: Any,
) -> None:
    import vnai

    setup_calls: list[str] = []

    def vendor_setup(project_root: str = ".") -> bool:
        setup_calls.append(project_root)
        return True

    monkeypatch.setattr(vnai, "async_setup_agent_environment", vendor_setup)

    def fake_import() -> type[FakeMarket]:
        assert vnai.async_setup_agent_environment(".") is False
        return FakeMarket

    assert _load_vnstock_market(fake_import) is FakeMarket
    assert vnai.async_setup_agent_environment is vendor_setup
    assert setup_calls == []


def test_vnstock_routes_xauusd_and_uses_utc_for_naive_commodity_time() -> None:
    market = FakeMarket(
        [
            {
                "time": "2026-08-10T00:00:00",
                "open": 2400,
                "high": 2410,
                "low": 2390,
                "close": 2405,
                "volume": None,
            }
        ]
    )

    rows = VnstockAdapter(market_factory=lambda: market).fetch(
        symbol="XAUUSD",
        asset="XAU",
        timeframe="1d",
        start=utc(2026, 8, 10),
        end=utc(2026, 8, 11),
        now=utc(2026, 8, 11),
    )

    assert market.commodity_calls == ["XAUUSD"]
    assert rows[0].timestamp == utc(2026, 8, 10)
    assert rows[0].source == "msn-via-vnstock"


def test_vnstock_rejects_xau_hourly_instead_of_resampling_daily_msn_data() -> None:
    market = FakeMarket([])

    with pytest.raises(ProviderUnavailableError) as raised:
        VnstockAdapter(market_factory=lambda: market).fetch(
            symbol="XAUUSD",
            asset="XAU",
            timeframe="1h",
            start=utc(2026, 8, 1),
            end=utc(2026, 8, 10),
            now=utc(2026, 8, 11),
        )

    assert raised.value.code == "unsupported_timeframe"
    assert market.commodity_calls == []


def test_dukascopy_xau_adapter_supports_real_daily_and_hourly_bars() -> None:
    calls: list[dict[str, Any]] = []

    def fetcher(**kwargs: Any) -> FakeDukascopyFrame:
        calls.append(kwargs)
        return FakeDukascopyFrame()

    adapter = DukascopyXauAdapter(fetcher=fetcher)

    daily = adapter.fetch(
        symbol="XAUUSD",
        asset="XAU",
        timeframe="1d",
        start=utc(2026, 8, 1),
        end=utc(2026, 8, 11),
        now=utc(2026, 8, 12),
    )
    hourly = adapter.fetch(
        symbol="XAUUSD",
        asset="XAU",
        timeframe="1h",
        start=utc(2026, 8, 10),
        end=utc(2026, 8, 11),
        now=utc(2026, 8, 12),
    )

    assert [row.source for row in daily + hourly] == [
        "dukascopy-public-bid",
        "dukascopy-public-bid",
    ]
    assert calls[0]["instrument"] == "XAU/USD"
    assert calls[0]["interval"] == "1DAY"
    assert calls[1]["interval"] == "1HOUR"


def test_dukascopy_xau_adapter_maps_dependency_errors_to_sanitized_failure() -> None:
    def fetcher(**_kwargs: Any) -> Any:
        raise RuntimeError("secret upstream detail")

    with pytest.raises(ProviderUnavailableError) as raised:
        DukascopyXauAdapter(fetcher=fetcher).fetch(
            symbol="XAUUSD",
            asset="XAU",
            timeframe="1d",
            start=utc(2026, 8, 1),
            end=utc(2026, 8, 11),
            now=utc(2026, 8, 12),
        )

    assert raised.value.code == "network_error"
    assert str(raised.value) == "Dukascopy request failed."


def test_xau_provider_code_uses_dukascopy_history_adapter() -> None:
    assert isinstance(
        provider_for_code("dukascopy-public", max_pages=10, max_rows=1_000),
        DukascopyXauAdapter,
    )


def test_vnstock_routes_fpt_through_vci() -> None:
    market = FakeMarket(
        [
            {
                "time": "2026-08-10T09:00:00",
                "open": 100,
                "high": 101,
                "low": 99,
                "close": 100,
                "volume": 10,
            }
        ]
    )

    VnstockAdapter(market_factory=lambda: market).fetch(
        symbol="FPT",
        asset="FPT",
        timeframe="1h",
        start=utc(2026, 8, 10),
        end=utc(2026, 8, 11),
        now=utc(2026, 8, 11),
    )

    assert market.equity_calls == [("FPT", "VCI")]
    assert market.instrument.calls[0]["count"] == 100_000


def test_vnstock_routes_vnindex_through_the_index_market() -> None:
    market = FakeMarket(
        [
            {
                "time": "2026-08-10T00:00:00",
                "open": 1_600,
                "high": 1_610,
                "low": 1_590,
                "close": 1_605,
                "volume": 1_000_000,
            }
        ]
    )

    rows = VnstockAdapter(market_factory=lambda: market).fetch(
        symbol="VNINDEX",
        asset="VNINDEX",
        timeframe="1d",
        start=utc(2026, 8, 10),
        end=utc(2026, 8, 12),
        now=utc(2026, 8, 12),
    )

    assert market.index_calls == ["VNINDEX"]
    assert market.equity_calls == []
    assert market.instrument.calls[0]["source"] == "KBS"
    assert rows[0].source == "vnstock-kbs-index"


def test_vnstock_caps_vnindex_history_to_the_free_eight_year_window() -> None:
    market = FakeMarket(
        [
            {
                "time": "2026-08-10T00:00:00",
                "open": 1_600,
                "high": 1_610,
                "low": 1_590,
                "close": 1_605,
                "volume": 1_000_000,
            }
        ]
    )

    VnstockAdapter(market_factory=lambda: market).fetch(
        symbol="VNINDEX",
        asset="VNINDEX",
        timeframe="1d",
        start=utc(2010, 1, 1),
        end=utc(2026, 8, 12),
        now=utc(2026, 8, 12),
    )

    assert market.instrument.calls[0]["start"] == "2018-08-14"


def test_vnstock_lists_current_hose_equities_from_listing_catalog() -> None:
    adapter = VnstockAdapter(
        listing_factory=lambda: FakeListing(
            [
                {
                    "symbol": "AAA",
                    "exchange": "HNX",
                    "organ_name": "Not HOSE",
                },
                {
                    "symbol": "FPT",
                    "exchange": "HOSE",
                    "type": "stock",
                    "organ_name": "FPT Corporation",
                },
                {
                    "symbol": "FUEVFVND",
                    "exchange": "HOSE",
                    "type": "fund",
                    "organ_name": "ETF",
                },
                {
                    "symbol": "VNM",
                    "exchange": "HSX",
                    "type": "stock",
                    "organ_name": "Vietnam Dairy Products",
                },
            ]
        )
    )

    descriptors = adapter.list_instruments()

    assert [
        (item.canonical_symbol, item.name, item.market, item.venue)
        for item in descriptors
        if item.market == "vn_equity"
    ] == [
        ("FPT", "FPT Corporation", "vn_equity", "HOSE"),
        ("VNM", "Vietnam Dairy Products", "vn_equity", "HOSE"),
    ]


def test_vnstock_rejects_missing_required_columns() -> None:
    market = FakeMarket([{"time": "2026-08-10T09:00:00", "close": 100}])

    with pytest.raises(ProviderUnavailableError) as raised:
        VnstockAdapter(market_factory=lambda: market).fetch(
            symbol="FPT",
            asset="FPT",
            timeframe="1h",
            start=utc(2026, 8, 10),
            end=utc(2026, 8, 11),
            now=utc(2026, 8, 11),
        )

    assert raised.value.code == "invalid_response"


def test_vnstock_drops_missing_price_sentinels_and_normalizes_negative_volume() -> None:
    market = FakeMarket(
        [
            {
                "time": "2026-08-07T00:00:00",
                "open": -99_999_902,
                "high": 4_371.63,
                "low": 4_229.22,
                "close": 4_341.71,
                "volume": -99_999_902,
            },
            {
                "time": "2026-08-08T00:00:00",
                "open": 4_341.71,
                "high": 4_380.00,
                "low": 4_300.00,
                "close": 4_350.00,
                "volume": -99_999_902,
            },
        ]
    )

    rows = VnstockAdapter(market_factory=lambda: market).fetch(
        symbol="XAUUSD",
        asset="XAU",
        timeframe="1d",
        start=utc(2026, 8, 7),
        end=utc(2026, 8, 9),
        now=utc(2026, 8, 10),
    )

    assert len(rows) == 1
    assert rows[0].timestamp == utc(2026, 8, 8)
    assert rows[0].volume is None


def test_vnstock_drops_provider_rows_with_impossible_ohlc_ordering() -> None:
    market = FakeMarket(
        [
            {
                "time": "2019-07-15T00:00:00",
                "open": 7.98,
                "high": 7.92,
                "low": 7.87,
                "close": 7.90,
                "volume": 763410,
            },
            {
                "time": "2019-07-16T00:00:00",
                "open": 7.90,
                "high": 8.10,
                "low": 7.80,
                "close": 8.00,
                "volume": 500000,
            },
        ]
    )

    rows = VnstockAdapter(market_factory=lambda: market).fetch(
        symbol="SSI",
        asset="SSI",
        timeframe="1d",
        start=utc(2019, 7, 15),
        end=utc(2019, 7, 17),
        now=utc(2019, 7, 18),
    )

    assert len(rows) == 1
    assert rows[0].timestamp == utc(2019, 7, 15, 17)


def test_vnstock_maps_provider_failures_to_a_sanitized_error() -> None:
    market = FakeMarket([], RuntimeError("upstream token=do-not-store"))

    with pytest.raises(ProviderUnavailableError) as raised:
        VnstockAdapter(market_factory=lambda: market).fetch(
            symbol="FPT",
            asset="FPT",
            timeframe="1d",
            start=utc(2026, 8, 1),
            end=utc(2026, 8, 11),
            now=utc(2026, 8, 11),
        )

    assert raised.value.code == "provider_unavailable"
    assert str(raised.value) == "Provider request failed."


def test_vnstock_retries_transient_provider_failures() -> None:
    attempts = 0
    sleeps: list[float] = []

    def market_factory() -> FakeMarket:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            return FakeMarket([], RuntimeError("temporary upstream failure"))
        return FakeMarket(
            [
                {
                    "time": "2026-08-10T00:00:00",
                    "open": 100,
                    "high": 101,
                    "low": 99,
                    "close": 100,
                    "volume": 10,
                }
            ]
        )

    rows = VnstockAdapter(
        market_factory=market_factory,
        sleep=sleeps.append,
    ).fetch(
        symbol="FPT",
        asset="FPT",
        timeframe="1d",
        start=utc(2026, 8, 1),
        end=utc(2026, 8, 11),
        now=utc(2026, 8, 12),
    )

    assert len(rows) == 1
    assert attempts == 3
    assert sleeps == [1.0, 2.0]


def test_vnstock_enforces_the_row_limit_before_normalization() -> None:
    records = [
        {
            "time": f"2026-08-{1 + index // 24:02d}T{index % 24:02d}:00:00",
            "open": 100,
            "high": 101,
            "low": 99,
            "close": 100,
            "volume": 10,
        }
        for index in range(101)
    ]
    market = FakeMarket(records)

    with pytest.raises(ProviderUnavailableError) as raised:
        VnstockAdapter(market_factory=lambda: market, max_rows=100).fetch(
            symbol="FPT",
            asset="FPT",
            timeframe="1d",
            start=utc(2026, 8, 1),
            end=utc(2026, 8, 10),
            now=utc(2026, 8, 11),
        )

    assert raised.value.code == "response_limit"


def test_feed_catalog_records_xauusd_dukascopy_provenance() -> None:
    assert FEEDS["XAU"].provider_symbol == "XAUUSD"
    assert FEEDS["XAU"].client_provider == "dukascopy-python"
    assert FEEDS["XAU"].upstream_provider == "dukascopy"


def test_feed_catalog_includes_liquid_vietnam_equities() -> None:
    expected_symbols = {"FPT", "VCB", "HPG", "VNM", "MWG", "SSI", "VIC"}

    assert expected_symbols <= set(FEEDS)
    assert {
        symbol
        for symbol, feed in FEEDS.items()
        if feed.provider_code == "vnstock-vci-free" and feed.market == "vn_equity"
    } >= expected_symbols
    assert all(FEEDS[symbol].maximum_leverage == Decimal("2") for symbol in expected_symbols)
    assert expected_symbols <= {
        item.canonical_symbol for item in VnstockAdapter().list_instruments()
    }


def test_feed_catalog_includes_vnindex_as_a_daily_benchmark() -> None:
    feed = FEEDS["VNINDEX"]

    assert feed.market == "vn_equity"
    assert feed.provider_code == "vnstock-kbs-free"
    assert feed.provider_symbol == "VNINDEX"
    assert feed.maximum_leverage == Decimal("1")


def test_binance_lists_only_trading_usdt_spot_instruments() -> None:
    transport = SequenceTransport(
        [
            HttpJsonResponse(
                200,
                {},
                {
                    "symbols": [
                        {"symbol": "DOGEUSDT", "baseAsset": "DOGE", "quoteAsset": "USDT", "status": "TRADING", "isSpotTradingAllowed": True},
                        {"symbol": "ETHUSDT", "baseAsset": "ETH", "quoteAsset": "USDT", "status": "TRADING", "isSpotTradingAllowed": True},
                        {"symbol": "OLDUSDT", "baseAsset": "OLD", "quoteAsset": "USDT", "status": "BREAK", "isSpotTradingAllowed": True},
                        {"symbol": "ETHBTC", "baseAsset": "ETH", "quoteAsset": "BTC", "status": "TRADING", "isSpotTradingAllowed": True},
                    ]
                },
            )
        ]
    )

    instruments = BinanceSpotAdapter(transport=transport).list_instruments()

    assert "DOGE" not in {item.canonical_symbol for item in instruments}
    assert {
        ProviderInstrumentDescriptor(
            provider_symbol="ETHUSDT",
            canonical_symbol="ETH",
            name="ETH / Tether",
            market="crypto_spot",
            venue="BINANCE",
            currency="USDT",
        ),
        ProviderInstrumentDescriptor(
            provider_symbol="XMRUSDT",
            canonical_symbol="XMR",
            name="XMR / Tether",
            market="crypto_spot",
            venue="BINANCE",
            currency="USDT",
        ),
    } <= set(instruments)
    assert transport.urls == [
        "https://data-api.binance.vision/api/v3/exchangeInfo"
        "?symbolStatus=TRADING&showPermissionSets=false"
    ]


def test_arbitrary_adapter_symbols_are_normalized_without_accepting_urls() -> None:
    assert BinanceSpotAdapter.normalize_symbol("eth", "ETHUSDT") == ("ETH", "ETHUSDT")
    assert VnstockAdapter.normalize_symbol("vnm", "VNM") == ("VNM", "VNM")
    with pytest.raises(ValueError):
        BinanceSpotAdapter.normalize_symbol("ETH", "https://evil.invalid")
