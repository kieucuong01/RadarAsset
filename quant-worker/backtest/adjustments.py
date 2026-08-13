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
    previous_close: Decimal,
    actions: list[CorporateActionRecord],
    *,
    cash_value_scale: Decimal,
) -> Decimal:
    cash = sum(
        (
            item.cash_per_share
            for item in actions
            if item.action_type == "cash_dividend" and item.cash_per_share is not None
        ),
        Decimal(0),
    )
    cash /= cash_value_scale
    distribution = sum(
        (
            item.distribution_ratio
            for item in actions
            if item.action_type in {"stock_dividend", "split"}
            and item.distribution_ratio is not None
        ),
        Decimal(0),
    )
    subscription_ratio = sum(
        (
            item.subscription_ratio
            for item in actions
            if item.action_type == "rights_issue" and item.subscription_ratio is not None
        ),
        Decimal(0),
    )
    subscription_value = sum(
        (
            item.subscription_ratio * item.subscription_price / cash_value_scale
            for item in actions
            if item.action_type == "rights_issue"
            and item.subscription_ratio is not None
            and item.subscription_price is not None
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
    cash_value_scale: Decimal = Decimal("1"),
) -> AdjustmentResult:
    if not coverage_complete:
        raise AdjustmentUnavailable("Corporate action coverage is incomplete.")
    if not cash_value_scale.is_finite() or cash_value_scale <= 0:
        raise AdjustmentUnavailable("Corporate action currency scale is invalid.")
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
        factors.append(
            (
                ex_date,
                _event_factor(
                    previous[-1].close,
                    by_date[ex_date],
                    cash_value_scale=cash_value_scale,
                ),
            )
        )

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
