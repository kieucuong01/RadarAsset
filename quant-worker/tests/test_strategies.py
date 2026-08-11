from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from backtest.models import Bar
from backtest.strategies import (
    AbcdCausalStrategy,
    MovingAverageCrossoverStrategy,
    SignalRollingReversalStrategy,
    StrategySignal,
    TurtleBreakoutStrategy,
)


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


def ohlc_bars(rows: list[tuple[str, str, str, str]]) -> list[Bar]:
    return [
        Bar(
            asset="BTC",
            timestamp=datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(days=index),
            timeframe="1d",
            open=Decimal(open_price),
            high=Decimal(high),
            low=Decimal(low),
            close=Decimal(close),
            volume=Decimal("100"),
            source="strategy-fixture",
        )
        for index, (open_price, high, low, close) in enumerate(rows)
    ]


def test_turtle_breakout_uses_prior_highs_and_lows_only() -> None:
    bars = ohlc_bars(
        [
            ("10", "10.5", "9.5", "10"),
            ("10", "11.5", "9.5", "11"),
            ("11", "11", "10", "10.5"),
            ("10.5", "12.5", "10", "12"),
            ("12", "12.2", "10.8", "11"),
            ("11", "11.2", "9", "9.5"),
        ]
    )
    strategy = TurtleBreakoutStrategy(entry_period=3, exit_period=2)

    assert strategy.signal(bars, 2, in_position=False) is None
    buy = strategy.signal(bars, 3, in_position=False)
    assert buy is not None
    assert buy.action == "buy"
    assert buy.reason == "turtle_entry_breakout"
    assert strategy.signal(bars, 4, in_position=True) is None
    sell = strategy.signal(bars, 5, in_position=True)
    assert sell is not None
    assert sell.action == "sell"
    assert sell.reason == "turtle_exit_breakout"


def test_turtle_breakout_does_not_read_future_bars() -> None:
    bars = ohlc_bars(
        [
            ("10", "10.5", "9.5", "10"),
            ("10", "11.5", "9.5", "11"),
            ("11", "11", "10", "10.5"),
            ("10.5", "12.5", "10", "12"),
            ("12", "12.2", "10.8", "11"),
        ]
    )
    strategy = TurtleBreakoutStrategy(entry_period=3, exit_period=2)
    baseline = strategy.signal(bars, 3, in_position=False)
    mutated = [*bars]
    mutated[-1] = Bar(**{**mutated[-1].__dict__, "high": Decimal("1000")})
    assert strategy.signal(mutated, 3, in_position=False) == baseline


def test_signal_rolling_reversal_requires_confirmed_direction() -> None:
    bars = bars_from_closes(["10", "11", "12", "13", "14", "13", "12", "11"])
    strategy = SignalRollingReversalStrategy(confirmation_bars=3)

    assert strategy.signal(bars, 2, in_position=False) is None
    buy = strategy.signal(bars, 3, in_position=False)
    assert buy is not None
    assert buy.action == "buy"
    assert buy.reason == "rolling_up_confirmation"
    assert strategy.signal(bars, 5, in_position=True) is None
    sell = strategy.signal(bars, 6, in_position=True)
    assert sell is not None
    assert sell.action == "sell"
    assert sell.reason == "rolling_down_reversal"


@pytest.mark.parametrize("confirmation_bars", [1, 21])
def test_signal_rolling_reversal_rejects_invalid_confirmation_window(confirmation_bars: int) -> None:
    with pytest.raises(ValueError, match="confirmation bars are invalid"):
        SignalRollingReversalStrategy(confirmation_bars=confirmation_bars)


def test_abcd_causal_enters_on_confirmed_c_and_exits_at_extension_target() -> None:
    bars = ohlc_bars(
        [
            ("10", "11", "9", "10"),
            ("9", "10", "8", "9"),
            ("12", "14", "11", "13"),
            ("11", "12", "10.5", "11"),
            ("12", "13", "11.5", "12"),
            ("17", "18", "15", "17.5"),
        ]
    )
    strategy = AbcdCausalStrategy(
        pivot_left_bars=1,
        pivot_right_bars=1,
        retracement_min=Decimal("0.382"),
        retracement_max=Decimal("0.886"),
        extension_min=Decimal("1.13"),
        extension_max=Decimal("1.618"),
    )

    assert strategy.signal(bars, 3, in_position=False) is None
    buy = strategy.signal(bars, 4, in_position=False)
    assert buy is not None
    assert buy.action == "buy"
    assert buy.reason == "abcd_c_confirmed"
    assert buy.signal_at == bars[4].timestamp

    sell = strategy.signal(bars, 5, in_position=True)
    assert sell is not None
    assert sell.action == "sell"
    assert sell.reason == "abcd_d_target"
    assert sell.metadata["target"] == "17.28"


def test_abcd_causal_does_not_use_unconfirmed_future_pivots() -> None:
    bars = ohlc_bars(
        [
            ("10", "11", "9", "10"),
            ("9", "10", "8", "9"),
            ("12", "14", "11", "13"),
            ("11", "12", "10.5", "11"),
            ("12", "13", "11.5", "12"),
        ]
    )
    bars.append(
        Bar(
            **{
                **bars[-1].__dict__,
                "timestamp": datetime(2024, 1, 6, tzinfo=timezone.utc),
                "high": Decimal("18"),
                "low": Decimal("10"),
            }
        )
    )
    strategy = AbcdCausalStrategy(1, 1, Decimal("0.382"), Decimal("0.886"), Decimal("1.13"), Decimal("1.618"))
    baseline = strategy.signal(bars, 4, in_position=False)
    mutated = [*bars]
    mutated[-1] = Bar(**{**mutated[-1].__dict__, "low": Decimal("1")})
    assert strategy.signal(mutated, 4, in_position=False) == baseline


def test_abcd_causal_rejects_invalid_ranges() -> None:
    with pytest.raises(ValueError, match="ABCD ranges are invalid"):
        AbcdCausalStrategy(1, 1, Decimal("0.9"), Decimal("0.5"), Decimal("1.1"), Decimal("1.6"))
