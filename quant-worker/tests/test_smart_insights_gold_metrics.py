from __future__ import annotations

from datetime import date
from decimal import Decimal
import json
from pathlib import Path

import pytest

from smart_insights.metrics.gold import (
    DatedPoint,
    GoldPricePoint,
    aligned_beta,
    aligned_correlation,
    calculate_xau_metrics,
)


FIXTURES = Path(__file__).parent / "fixtures" / "smart_insights" / "gold"


def load_price_fixture(name: str) -> tuple[GoldPricePoint, ...]:
    rows = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return tuple(
        GoldPricePoint(
            date=date.fromisoformat(row["date"]),
            close=Decimal(row["close"]),
            dataset_version_id=row["datasetVersionId"],
        )
        for row in rows
    )


def points(*rows: tuple[str, str], version: str = "v1") -> tuple[DatedPoint, ...]:
    return tuple(
        DatedPoint(date.fromisoformat(raw_date), Decimal(value), version)
        for raw_date, value in rows
    )


def test_xau_metrics_are_closed_day_and_decimal_stable() -> None:
    result = calculate_xau_metrics(
        load_price_fixture("xau_daily.json"), as_of=date(2026, 8, 12)
    )
    assert result.effective_date == date(2026, 8, 12)
    assert result.return_1d == Decimal("0.010000")
    assert result.drawdown_from_peak == Decimal("-0.019706")
    assert result.dataset_version_ids == ("xau-v1",)
    assert result.momentum_20d is None
    assert result.volatility_20d is None


def test_xau_metrics_reject_future_duplicate_and_mixed_dataset_rows() -> None:
    rows = load_price_fixture("xau_daily.json")
    with pytest.raises(ValueError, match="future"):
        calculate_xau_metrics(rows, as_of=date(2026, 8, 11))
    with pytest.raises(ValueError, match="Duplicate"):
        calculate_xau_metrics(rows + (rows[-1],), as_of=date(2026, 8, 12))
    with pytest.raises(ValueError, match="active dataset version"):
        calculate_xau_metrics(
            rows[:-1]
            + (
                GoldPricePoint(
                    rows[-1].date, rows[-1].close, "xau-future-version"
                ),
            ),
            as_of=date(2026, 8, 12),
        )


def test_cross_asset_math_uses_only_timestamp_intersection() -> None:
    gold = points(("2026-01-01", "1"), ("2026-01-02", "2"), ("2026-01-03", "3"), version="gold-v1")
    real_yield = points(("2026-01-01", "3"), ("2026-01-03", "1"), version="fred-v1")
    correlation = aligned_correlation(gold, real_yield, minimum_points=2)
    beta = aligned_beta(gold, real_yield, minimum_points=2)

    assert correlation.point_count == 2
    assert correlation.value == Decimal("-1.000000")
    assert correlation.input_dataset_versions == ("fred-v1", "gold-v1")
    assert beta.value == Decimal("-1.000000")


def test_cross_asset_metrics_are_unavailable_below_minimum_or_zero_variance() -> None:
    gold = points(("2026-01-01", "1"), ("2026-01-02", "2"))
    benchmark = points(("2026-01-01", "3"), ("2026-01-02", "3"))

    assert aligned_correlation(gold, benchmark, minimum_points=3).value is None
    assert aligned_beta(gold, benchmark, minimum_points=2).value is None
