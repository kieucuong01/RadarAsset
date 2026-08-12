from datetime import datetime, timezone
from decimal import Decimal

from backtest.custom_execution import run_price_threshold
from backtest.custom_rules import PriceThresholdRule
from backtest.models import Bar


def bars() -> list[Bar]:
    closes = ["99", "101", "102", "98", "101", "102"]
    opens = ["99", "100", "103", "99", "100", "102"]
    return [
        Bar(
            asset="BTC",
            timestamp=datetime(2026, 1, index + 1, tzinfo=timezone.utc),
            timeframe="1d",
            open=Decimal(open_price),
            high=max(Decimal(open_price), Decimal(close)),
            low=min(Decimal(open_price), Decimal(close)),
            close=Decimal(close),
            volume=Decimal("1"),
            source="test",
        )
        for index, (open_price, close) in enumerate(zip(opens, closes, strict=True))
    ]


def test_true_crossings_fill_once_at_the_next_bar_open() -> None:
    result = run_price_threshold(
        "BTC",
        bars(),
        initial_capital=Decimal("1000"),
        rule=PriceThresholdRule("crosses_above", Decimal("100"), "USD", "buy", Decimal("25")),
        fee_bps=Decimal("10"),
        sell_tax_bps=Decimal("0"),
        slippage_bps=Decimal("5"),
        strategy_hash="a" * 64,
        dataset_checksum="b" * 64,
    )

    assert len(result.trades) == 2
    assert [row["signalAt"] for row in result.trades] == [
        "2026-01-02T00:00:00Z",
        "2026-01-05T00:00:00Z",
    ]
    assert [row["executedAt"] for row in result.trades] == [
        "2026-01-03T00:00:00Z",
        "2026-01-06T00:00:00Z",
    ]
    assert result.trades[0]["action"] == "buy"
    assert result.trades[0]["quantity"] > 0
    assert result.summary["tradeCount"] == 2
    assert result.summary["totalFees"] > 0


def test_sell_crossing_while_flat_is_non_actionable() -> None:
    result = run_price_threshold(
        "BTC",
        bars(),
        initial_capital=Decimal("1000"),
        rule=PriceThresholdRule("crosses_above", Decimal("100"), "USD", "sell", Decimal("50")),
        fee_bps=Decimal("0"),
        sell_tax_bps=Decimal("0"),
        slippage_bps=Decimal("0"),
        strategy_hash="a" * 64,
        dataset_checksum="b" * 64,
    )

    assert result.trades == []
    assert result.summary["tradeCount"] == 0
