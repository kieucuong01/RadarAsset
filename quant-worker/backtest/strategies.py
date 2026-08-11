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
