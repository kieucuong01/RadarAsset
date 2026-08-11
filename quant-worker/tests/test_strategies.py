from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from backtest.models import Bar
from backtest.strategies import MovingAverageCrossoverStrategy, StrategySignal


def bars_from_closes(closes: list[str]) -> list[Bar]:
    rows: list[Bar] = []
    previous = Decimal(closes[0])
    for index, close_text in enumerate(closes):
        close = Decimal(close_text)
        rows.append(
            Bar(
                asset="BTC",
                timestamp=datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(days=index),
                timeframe="1d",
                open=previous,
                high=max(previous, close) + Decimal("1"),
                low=min(previous, close) - Decimal("1"),
                close=close,
                volume=Decimal("100"),
                source="strategy-fixture",
            )
        )
        previous = close
    return rows


def test_ma_crossover_emits_causal_close_signals() -> None:
    bars = bars_from_closes(["10", "9", "8", "10", "12", "13", "8", "7"])
    strategy = MovingAverageCrossoverStrategy(fast_period=2, slow_period=3)

    assert strategy.signal(bars, 3, in_position=False) is None
    buy = strategy.signal(bars, 4, in_position=False)
    assert isinstance(buy, StrategySignal)
    assert buy.action == "buy"
    assert buy.reason == "ma_bullish_cross"
    assert buy.signal_at == bars[4].timestamp

    assert strategy.signal(bars, 5, in_position=True) is None
    sell = strategy.signal(bars, 6, in_position=True)
    assert isinstance(sell, StrategySignal)
    assert sell.action == "sell"
    assert sell.reason == "ma_bearish_cross"
    assert sell.signal_at == bars[6].timestamp


def test_ma_crossover_does_not_read_future_bars() -> None:
    bars = bars_from_closes(["10", "9", "8", "10", "12", "13", "8", "7"])
    strategy = MovingAverageCrossoverStrategy(fast_period=2, slow_period=3)
    baseline = strategy.signal(bars, 4, in_position=False)

    mutated = [*bars]
    mutated[-1] = Bar(**{**mutated[-1].__dict__, "close": Decimal("1000")})
    assert strategy.signal(mutated, 4, in_position=False) == baseline


@pytest.mark.parametrize(
    ("fast_period", "slow_period"),
    [(1, 3), (3, 3), (4, 2)],
)
def test_ma_crossover_rejects_invalid_periods(fast_period: int, slow_period: int) -> None:
    with pytest.raises(ValueError, match="periods are invalid"):
        MovingAverageCrossoverStrategy(fast_period=fast_period, slow_period=slow_period)
