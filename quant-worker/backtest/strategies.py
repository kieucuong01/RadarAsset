from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Literal, Protocol, Sequence

from talipp.indicators import ATR, BB, EMA, MACD, RSI
from talipp.ohlcv import OHLCV

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
    warmup_bars: int

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

    @property
    def warmup_bars(self) -> int:
        return self.slow_period

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

    @property
    def warmup_bars(self) -> int:
        return max(self.entry_period, self.exit_period)

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

    @property
    def warmup_bars(self) -> int:
        return self.confirmation_bars

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

    @property
    def warmup_bars(self) -> int:
        return self.pivot_left_bars + self.pivot_right_bars + 4

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


def _float_closes(bars: Sequence[Bar], index: int) -> list[float]:
    return [float(bar.close) for bar in bars[: index + 1]]


@dataclass
class EmaTrendStrategy:
    fast_period: int
    slow_period: int
    code: str = "ema_trend"
    version: str = "1.0.0"
    _prepared_id: int | None = field(default=None, init=False, repr=False)
    _fast_values: list[float | None] | None = field(default=None, init=False, repr=False)
    _slow_values: list[float | None] | None = field(default=None, init=False, repr=False)

    @property
    def warmup_bars(self) -> int:
        return self.slow_period + 1

    def __post_init__(self) -> None:
        if self.fast_period < 2 or self.fast_period >= self.slow_period:
            raise ValueError("EMA periods are invalid.")

    def prepare(self, bars: Sequence[Bar]) -> None:
        closes = _float_closes(bars, len(bars) - 1)
        self._prepared_id = id(bars)
        self._fast_values = list(EMA(self.fast_period, closes))
        self._slow_values = list(EMA(self.slow_period, closes))

    def signal(self, bars: Sequence[Bar], index: int, *, in_position: bool) -> StrategySignal | None:
        if index < self.slow_period:
            return None
        if self._prepared_id == id(bars) and self._fast_values is not None and self._slow_values is not None:
            fast, slow = self._fast_values, self._slow_values
        else:
            closes = _float_closes(bars, index)
            fast, slow = list(EMA(self.fast_period, closes)), list(EMA(self.slow_period, closes))
        if fast[-2] is None or slow[-2] is None or fast[-1] is None or slow[-1] is None:
            return None
        metadata = {"fastEma": str(fast[-1]), "slowEma": str(slow[-1])}
        if not in_position and fast[-2] <= slow[-2] and fast[-1] > slow[-1]:
            return StrategySignal("buy", bars[index].timestamp, "ema_bullish_cross", metadata)
        if in_position and fast[-2] >= slow[-2] and fast[-1] < slow[-1]:
            return StrategySignal("sell", bars[index].timestamp, "ema_bearish_cross", metadata)
        return None


@dataclass
class RsiMeanReversionStrategy:
    period: int
    oversold: Decimal
    overbought: Decimal
    code: str = "rsi_mean_reversion"
    version: str = "1.0.0"
    _prepared_id: int | None = field(default=None, init=False, repr=False)
    _values: list[float | None] | None = field(default=None, init=False, repr=False)

    @property
    def warmup_bars(self) -> int:
        return self.period + 1

    def __post_init__(self) -> None:
        if self.period < 2 or not Decimal("1") <= self.oversold < self.overbought <= Decimal("99"):
            raise ValueError("RSI parameters are invalid.")

    def prepare(self, bars: Sequence[Bar]) -> None:
        self._prepared_id = id(bars)
        self._values = list(RSI(self.period, _float_closes(bars, len(bars) - 1)))

    def signal(self, bars: Sequence[Bar], index: int, *, in_position: bool) -> StrategySignal | None:
        if index < self.period:
            return None
        value = (
            self._values[index]
            if self._prepared_id == id(bars) and self._values is not None
            else RSI(self.period, _float_closes(bars, index))[-1]
        )
        if value is None:
            return None
        metadata = {"rsi": str(value)}
        if not in_position and Decimal(str(value)) <= self.oversold:
            return StrategySignal("buy", bars[index].timestamp, "rsi_oversold", metadata)
        if in_position and Decimal(str(value)) >= self.overbought:
            return StrategySignal("sell", bars[index].timestamp, "rsi_recovered", metadata)
        return None


@dataclass
class BollingerMeanReversionStrategy:
    period: int
    standard_deviations: Decimal
    code: str = "bollinger_mean_reversion"
    version: str = "1.0.0"
    _prepared_id: int | None = field(default=None, init=False, repr=False)
    _values: list[object | None] | None = field(default=None, init=False, repr=False)

    @property
    def warmup_bars(self) -> int:
        return self.period

    def __post_init__(self) -> None:
        if self.period < 2 or not Decimal("0.5") <= self.standard_deviations <= Decimal("5"):
            raise ValueError("Bollinger parameters are invalid.")

    def prepare(self, bars: Sequence[Bar]) -> None:
        self._prepared_id = id(bars)
        self._values = list(BB(self.period, float(self.standard_deviations), _float_closes(bars, len(bars) - 1)))

    def signal(self, bars: Sequence[Bar], index: int, *, in_position: bool) -> StrategySignal | None:
        if index < self.period - 1:
            return None
        value = (
            self._values[index]
            if self._prepared_id == id(bars) and self._values is not None
            else BB(self.period, float(self.standard_deviations), _float_closes(bars, index))[-1]
        )
        if value is None:
            return None
        close = float(bars[index].close)
        metadata = {"lowerBand": str(value.lb), "centerBand": str(value.cb), "upperBand": str(value.ub)}
        if not in_position and close < value.lb:
            return StrategySignal("buy", bars[index].timestamp, "bollinger_lower_break", metadata)
        if in_position and close >= value.cb:
            return StrategySignal("sell", bars[index].timestamp, "bollinger_mean_reversion", metadata)
        return None


@dataclass
class MacdMomentumStrategy:
    fast_period: int
    slow_period: int
    signal_period: int
    code: str = "macd_momentum"
    version: str = "1.0.0"
    _prepared_id: int | None = field(default=None, init=False, repr=False)
    _values: list[object | None] | None = field(default=None, init=False, repr=False)

    @property
    def warmup_bars(self) -> int:
        return self.slow_period + self.signal_period

    def __post_init__(self) -> None:
        if self.fast_period < 2 or self.fast_period >= self.slow_period or self.signal_period < 2:
            raise ValueError("MACD periods are invalid.")

    def prepare(self, bars: Sequence[Bar]) -> None:
        self._prepared_id = id(bars)
        self._values = list(MACD(self.fast_period, self.slow_period, self.signal_period, _float_closes(bars, len(bars) - 1)))

    def signal(self, bars: Sequence[Bar], index: int, *, in_position: bool) -> StrategySignal | None:
        if index < self.warmup_bars:
            return None
        values = (
            self._values
            if self._prepared_id == id(bars) and self._values is not None
            else list(MACD(self.fast_period, self.slow_period, self.signal_period, _float_closes(bars, index)))
        )
        previous, current = values[-2], values[-1]
        if (
            previous is None
            or current is None
            or previous.histogram is None
            or current.histogram is None
        ):
            return None
        metadata = {"macd": str(current.macd), "signal": str(current.signal), "histogram": str(current.histogram)}
        if not in_position and previous.histogram <= 0 < current.histogram:
            return StrategySignal("buy", bars[index].timestamp, "macd_bullish_cross", metadata)
        if in_position and previous.histogram >= 0 > current.histogram:
            return StrategySignal("sell", bars[index].timestamp, "macd_bearish_cross", metadata)
        return None


@dataclass
class AtrBreakoutStrategy:
    atr_period: int
    breakout_period: int
    exit_period: int
    atr_multiplier: Decimal
    code: str = "atr_breakout"
    version: str = "1.0.0"
    _prepared_id: int | None = field(default=None, init=False, repr=False)
    _values: list[float | None] | None = field(default=None, init=False, repr=False)

    @property
    def warmup_bars(self) -> int:
        return max(self.atr_period, self.breakout_period, self.exit_period)

    def __post_init__(self) -> None:
        if min(self.atr_period, self.breakout_period, self.exit_period) < 2 or not Decimal("0") <= self.atr_multiplier <= Decimal("5"):
            raise ValueError("ATR breakout parameters are invalid.")

    @staticmethod
    def _ohlcv(bars: Sequence[Bar], end: int) -> list[OHLCV]:
        return [
            OHLCV(float(bar.open), float(bar.high), float(bar.low), float(bar.close), None if bar.volume is None else float(bar.volume), bar.timestamp)
            for bar in bars[: end + 1]
        ]

    def prepare(self, bars: Sequence[Bar]) -> None:
        self._prepared_id = id(bars)
        self._values = list(ATR(self.atr_period, self._ohlcv(bars, len(bars) - 1)))

    def signal(self, bars: Sequence[Bar], index: int, *, in_position: bool) -> StrategySignal | None:
        if index < self.warmup_bars:
            return None
        atr = (
            self._values[index]
            if self._prepared_id == id(bars) and self._values is not None
            else ATR(self.atr_period, self._ohlcv(bars, index))[-1]
        )
        if atr is None:
            return None
        entry = max(bar.high for bar in bars[index - self.breakout_period : index]) + Decimal(str(atr)) * self.atr_multiplier
        exit_level = min(bar.low for bar in bars[index - self.exit_period : index])
        metadata = {"atr": str(atr), "entryLevel": str(entry), "exitLevel": str(exit_level)}
        if not in_position and bars[index].close > entry:
            return StrategySignal("buy", bars[index].timestamp, "atr_breakout_entry", metadata)
        if in_position and bars[index].close < exit_level:
            return StrategySignal("sell", bars[index].timestamp, "atr_breakout_exit", metadata)
        return None
