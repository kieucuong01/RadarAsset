from datetime import datetime, timezone
from decimal import Decimal

from backtest.providers import BinanceSpotAdapter, VnstockAdapter


def test_binance_adapter_maps_the_complete_public_kline_shape() -> None:
    payload = [
        [
            1704067200000,
            "42000.1",
            "42500.2",
            "41900.3",
            "42400.4",
            "123.45",
            1704070799999,
            "5200000.00",
            1234,
            "60.00",
            "2500000.00",
            "0",
        ]
    ]

    rows = BinanceSpotAdapter.parse_klines(payload, asset="BTC", timeframe="1h")

    assert len(rows) == 1
    assert rows[0].timestamp == datetime(2024, 1, 1, tzinfo=timezone.utc)
    assert (rows[0].open, rows[0].high, rows[0].low, rows[0].close) == (
        Decimal("42000.1"),
        Decimal("42500.2"),
        Decimal("41900.3"),
        Decimal("42400.4"),
    )
    assert rows[0].volume == Decimal("123.45")
    assert rows[0].source == "binance-public-spot"


def test_vnstock_adapter_normalizes_vietnam_time_to_utc() -> None:
    records = [
        {
            "time": "2024-01-02T09:00:00+07:00",
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
        source="vnstock-free",
    )

    assert rows[0].timestamp == datetime(2024, 1, 2, 2, tzinfo=timezone.utc)
    assert rows[0].close == Decimal("83.2")
    assert rows[0].volume == Decimal("1230000")
    assert rows[0].source == "vnstock-free"
