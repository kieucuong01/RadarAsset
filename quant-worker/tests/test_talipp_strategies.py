from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from backtest.models import Bar
from backtest.strategies import (
    AtrBreakoutStrategy,
    BollingerMeanReversionStrategy,
    EmaTrendStrategy,
    MacdMomentumStrategy,
    RsiMeanReversionStrategy,
)


def bars(closes: list[int]) -> list[Bar]:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    return [
        Bar(
            asset="BTC",
            timestamp=start + timedelta(days=index),
            timeframe="1d",
            open=Decimal(close),
            high=Decimal(close) + Decimal("0.2"),
            low=Decimal(close) - Decimal("0.2"),
            close=Decimal(close),
            volume=Decimal("100"),
            source="test",
        )
        for index, close in enumerate(closes)
    ]


@pytest.mark.parametrize(
    "strategy,closes",
    [
        (EmaTrendStrategy(2, 4), [10, 9, 8, 7, 8, 9, 10, 11]),
        (RsiMeanReversionStrategy(3, Decimal("30"), Decimal("60")), [10, 9, 8, 7, 6, 7, 8, 9, 10]),
        (BollingerMeanReversionStrategy(3, Decimal("1")), [10, 10, 10, 7, 8, 10, 11]),
        (MacdMomentumStrategy(2, 4, 2), [10, 9, 8, 7, 6, 5, 5, 6, 8, 10, 12, 11, 9, 7]),
        (AtrBreakoutStrategy(2, 3, 2, Decimal("0")), [10, 10, 10, 11, 12, 9, 8]),
    ],
)
def test_talipp_strategy_emits_causal_buy_signal(strategy, closes: list[int]) -> None:
    rows = bars(closes)
    signals = [strategy.signal(rows, index, in_position=False) for index in range(len(rows))]
    assert any(signal is not None and signal.action == "buy" for signal in signals)
