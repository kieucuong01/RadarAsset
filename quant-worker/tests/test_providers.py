from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import pytest

from backtest.catalog import FEEDS
from backtest.providers import (
    BinanceSpotAdapter,
    HttpJsonResponse,
    ProviderUnavailableError,
    VnstockAdapter,
)


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
        self.commodity_calls: list[str] = []

    def equity(self, symbol: str, *, source: str) -> FakeInstrument:
        self.equity_calls.append((symbol, source))
        return self.instrument

    def commodity(self, symbol: str) -> FakeInstrument:
        self.commodity_calls.append(symbol)
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


def test_vnstock_routes_xauusd_and_uses_utc_for_naive_commodity_time() -> None:
    market = FakeMarket(
        [
            {
                "time": "2026-08-10T12:00:00",
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
        timeframe="1h",
        start=utc(2026, 8, 10),
        end=utc(2026, 8, 11),
        now=utc(2026, 8, 11),
    )

    assert market.commodity_calls == ["XAUUSD"]
    assert rows[0].timestamp == utc(2026, 8, 10, 12)
    assert rows[0].source == "dukascopy-via-vnstock"


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
            symbol="XAUUSD",
            asset="XAU",
            timeframe="1h",
            start=utc(2026, 8, 1),
            end=utc(2026, 8, 10),
            now=utc(2026, 8, 11),
        )

    assert raised.value.code == "response_limit"


def test_feed_catalog_records_xauusd_dukascopy_provenance() -> None:
    assert FEEDS["XAU"].provider_symbol == "XAUUSD"
    assert FEEDS["XAU"].client_provider == "vnstock"
    assert FEEDS["XAU"].upstream_provider == "dukascopy"
