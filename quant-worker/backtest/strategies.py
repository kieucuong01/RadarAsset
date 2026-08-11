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


@dataclass(frozen=True)
class _Pivot:
    index: int
    kind: Literal["high", "low"]
    price: Decimal


@dataclass(frozen=True)
class _AbcdPattern:
    a: _Pivot
    b: _Pivot
    c: _Pivot
    target: Decimal
    target_max: Decimal


@dataclass(frozen=True)
class AbcdCausalStrategy:
    pivot_left_bars: int
    pivot_right_bars: int
    retracement_min: Decimal
    retracement_max: Decimal
    extension_min: Decimal
    extension_max: Decimal
    code: str = "abcd_causal"
    version: str = "1.0.0"

    def __post_init__(self) -> None:
        if (
            self.pivot_left_bars < 1
            or self.pivot_right_bars < 1
            or self.retracement_min <= 0
            or self.retracement_min >= self.retracement_max
            or self.extension_min <= 0
            or self.extension_min >= self.extension_max
        ):
            raise ValueError("ABCD ranges are invalid.")

    def _confirmed_pivots(self, bars: Sequence[Bar], index: int) -> list[_Pivot]:
        rows = bars[: index + 1]
        last_candidate = index - self.pivot_right_bars
        if last_candidate < self.pivot_left_bars:
            return []

        pivots: list[_Pivot] = []
        for candidate in range(self.pivot_left_bars, last_candidate + 1):
            current = rows[candidate]
            left = rows[candidate - self.pivot_left_bars : candidate]
            right = rows[candidate + 1 : candidate + self.pivot_right_bars + 1]
            neighbors = [*left, *right]
            if all(current.low < row.low for row in neighbors):
                pivots.append(_Pivot(candidate, "low", current.low))
            elif all(current.high > row.high for row in neighbors):
                pivots.append(_Pivot(candidate, "high", current.high))
        return pivots

    def _latest_pattern(self, pivots: Sequence[_Pivot]) -> _AbcdPattern | None:
        latest: _AbcdPattern | None = None
        for offset in range(len(pivots) - 2):
            a, b, c = pivots[offset : offset + 3]
            if (a.kind, b.kind, c.kind) != ("low", "high", "low"):
                continue
            ab = b.price - a.price
            if ab <= 0:
                continue
            retracement = (b.price - c.price) / ab
            if not self.retracement_min <= retracement <= self.retracement_max:
                continue
            pattern = _AbcdPattern(
                a=a,
                b=b,
                c=c,
                target=c.price + ab * self.extension_min,
                target_max=c.price + ab * self.extension_max,
            )
            if latest is None or pattern.c.index > latest.c.index:
                latest = pattern
        return latest

    def signal(
        self,
        bars: Sequence[Bar],
        index: int,
        *,
        in_position: bool,
    ) -> StrategySignal | None:
        if index < 0 or index >= len(bars):
            raise ValueError("Strategy bar index is invalid.")
        pattern = self._latest_pattern(self._confirmed_pivots(bars, index))
        if pattern is None:
            return None
        confirmation_index = pattern.c.index + self.pivot_right_bars
        if not in_position and confirmation_index == index:
            return StrategySignal(
                "buy",
                bars[index].timestamp,
                "abcd_c_confirmed",
                {
                    "retracement": str(
                        (pattern.b.price - pattern.c.price) / (pattern.b.price - pattern.a.price)
                    ),
                    "target": str(pattern.target.normalize()),
                },
            )
        if in_position and index > confirmation_index and bars[index].close >= pattern.target:
            return StrategySignal(
                "sell",
                bars[index].timestamp,
                "abcd_d_target",
                {
                    "target": str(pattern.target.normalize()),
                    "targetMax": str(pattern.target_max.normalize()),
                },
            )
        return None
