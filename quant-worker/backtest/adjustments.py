from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, localcontext
from typing import Iterable

from .corporate_actions import CorporateActionRecord
from .market_calendar import timestamp_to_market_date
from .models import Bar
from .quality import normalize_bars


class AdjustmentUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class AdjustmentResult:
    rows: tuple[Bar, ...]
    policy: str
    applied_event_count: int
    skipped_unverified: int


def _event_factor(
    previous_close: Decimal, actions: list[CorporateActionRecord]
) -> Decimal:
    cash = sum((item.cash_per_share or Decimal(0) for item in actions), Decimal(0))
    distribution = sum(
        (item.distribution_ratio or Decimal(0) for item in actions), Decimal(0)
    )
    subscription_ratio = sum(
        (item.subscription_ratio or Decimal(0) for item in actions), Decimal(0)
    )
    subscription_value = sum(
        (
            (item.subscription_ratio or Decimal(0))
            * (item.subscription_price or Decimal(0))
            for item in actions
        ),
        Decimal(0),
    )
    with localcontext() as context:
        context.prec = 36
        theoretical_ex_price = (
            previous_close - cash + subscription_value
        ) / (Decimal(1) + distribution + subscription_ratio)
        factor = theoretical_ex_price / previous_close
    if not factor.is_finite() or factor <= 0:
        raise AdjustmentUnavailable("Corporate action produced an invalid adjustment factor.")
    return factor


def adjust_total_return_bars(
    rows: Iterable[Bar],
    actions: Iterable[CorporateActionRecord],
    *,
    coverage_complete: bool,
) -> AdjustmentResult:
    if not coverage_complete:
        raise AdjustmentUnavailable("Corporate action coverage is incomplete.")
    normalized = normalize_bars(rows)
    if not normalized:
        raise AdjustmentUnavailable("Raw dataset is empty.")
    if normalized[0].asset != normalized[-1].asset:
        raise AdjustmentUnavailable("Adjusted dataset must contain one asset.")

    skipped = 0
    by_date: dict[date, list[CorporateActionRecord]] = {}
    for item in actions:
        if item.asset != normalized[0].asset:
            raise AdjustmentUnavailable("Corporate action asset does not match raw bars.")
        if item.status != "verified" or item.ex_right_date is None:
            skipped += 1
            continue
        by_date.setdefault(item.ex_right_date, []).append(item)

    factors: list[tuple[date, Decimal]] = []
    for ex_date in sorted(by_date):
        previous = [
            row
            for row in normalized
            if timestamp_to_market_date(row.timestamp, "vn_equity") < ex_date
        ]
        if not previous:
            continue
        factors.append((ex_date, _event_factor(previous[-1].close, by_date[ex_date])))

    adjusted: list[Bar] = []
    with localcontext() as context:
        context.prec = 36
        for row in normalized:
            market_date = timestamp_to_market_date(row.timestamp, "vn_equity")
            cumulative = Decimal(1)
            for ex_date, factor in factors:
                if market_date < ex_date:
                    cumulative *= factor
            adjusted.append(
                Bar(
                    asset=row.asset,
                    timestamp=row.timestamp,
                    timeframe=row.timeframe,
                    open=row.open * cumulative,
                    high=row.high * cumulative,
                    low=row.low * cumulative,
                    close=row.close * cumulative,
                    volume=None if row.volume is None else row.volume / cumulative,
                    source=f"{row.source}:total-return-adjusted",
                )
            )
    return AdjustmentResult(
        rows=tuple(adjusted),
        policy="total_return",
        applied_event_count=sum(len(items) for items in by_date.values()),
        skipped_unverified=skipped,
    )
