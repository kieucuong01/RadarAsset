from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Literal, Protocol, Sequence

from .models import Bar


Action = Literal["buy", "sell"]


@dataclass(frozen=True)
class StrategySignal:
    action: Action
    signal_at: datetime
    reason: str
    metadata: dict[str, str] = field(default_factory=dict)


class Strategy(Protocol):
    code: str
    version: str

    def signal(
        self,
        bars: Sequence[Bar],
        index: int,
        *,
        in_position: bool,
    ) -> StrategySignal | None: ...


def _sma(closes: Sequence[Decimal], end: int, period: int) -> Decimal:
    window = closes[end - period + 1 : end + 1]
    return sum(window, Decimal("0")) / Decimal(period)


@dataclass(frozen=True)
class MovingAverageCrossoverStrategy:
    fast_period: int
    slow_period: int
    code: str = "ma_crossover"
    version: str = "1.0.0"

    def __post_init__(self) -> None:
        if self.fast_period < 2 or self.fast_period >= self.slow_period:
            raise ValueError("MA periods are invalid.")

    def signal(
        self,
        bars: Sequence[Bar],
        index: int,
        *,
        in_position: bool,
    ) -> StrategySignal | None:
        if index < 0 or index >= len(bars):
            raise ValueError("Strategy bar index is invalid.")
        if index < self.slow_period:
            return None

        closes = [bar.close for bar in bars[: index + 1]]
        previous_fast = _sma(closes, index - 1, self.fast_period)
        previous_slow = _sma(closes, index - 1, self.slow_period)
        current_fast = _sma(closes, index, self.fast_period)
        current_slow = _sma(closes, index, self.slow_period)
        metadata = {
            "fast": str(current_fast),
            "slow": str(current_slow),
        }
        if not in_position and previous_fast <= previous_slow and current_fast > current_slow:
            return StrategySignal("buy", bars[index].timestamp, "ma_bullish_cross", metadata)
        if in_position and previous_fast >= previous_slow and current_fast < current_slow:
            return StrategySignal("sell", bars[index].timestamp, "ma_bearish_cross", metadata)
        return None


@dataclass(frozen=True)
class TurtleBreakoutStrategy:
    entry_period: int
    exit_period: int
    code: str = "turtle_breakout"
    version: str = "1.0.0"

    def __post_init__(self) -> None:
        if self.entry_period < 2 or self.exit_period < 2:
            raise ValueError("Turtle periods are invalid.")

    def signal(
        self,
        bars: Sequence[Bar],
        index: int,
        *,
        in_position: bool,
    ) -> StrategySignal | None:
        if index < 0 or index >= len(bars):
            raise ValueError("Strategy bar index is invalid.")
        if index < max(self.entry_period, self.exit_period):
            return None

        current = bars[index]
        entry_window = bars[index - self.entry_period : index]
        exit_window = bars[index - self.exit_period : index]
        entry_level = max(bar.high for bar in entry_window)
        exit_level = min(bar.low for bar in exit_window)
        if not in_position and current.close > entry_level:
            return StrategySignal(
                "buy",
                current.timestamp,
                "turtle_entry_breakout",
                {"breakoutLevel": str(entry_level)},
            )
        if in_position and current.close < exit_level:
            return StrategySignal(
                "sell",
                current.timestamp,
                "turtle_exit_breakout",
                {"breakoutLevel": str(exit_level)},
            )
        return None


@dataclass(frozen=True)
class SignalRollingReversalStrategy:
    confirmation_bars: int
    code: str = "signal_rolling_reversal"
    version: str = "1.0.0"

    def __post_init__(self) -> None:
        if self.confirmation_bars < 2 or self.confirmation_bars > 20:
            raise ValueError("Rolling confirmation bars are invalid.")

    def signal(
        self,
        bars: Sequence[Bar],
        index: int,
        *,
        in_position: bool,
    ) -> StrategySignal | None:
        if index < 0 or index >= len(bars):
            raise ValueError("Strategy bar index is invalid.")
        if index < self.confirmation_bars:
            return None

        start = index - self.confirmation_bars + 1
        window = bars[start : index + 1]
        rising = all(window[offset].close > window[offset - 1].close for offset in range(1, len(window)))
        falling = all(window[offset].close < window[offset - 1].close for offset in range(1, len(window)))
        if not in_position and rising:
            return StrategySignal(
                "buy",
                bars[index].timestamp,
                "rolling_up_confirmation",
                {"confirmationBars": str(self.confirmation_bars)},
            )
        if in_position and falling:
            return StrategySignal(
                "sell",
                bars[index].timestamp,
                "rolling_down_reversal",
                {"confirmationBars": str(self.confirmation_bars)},
            )
        return None
