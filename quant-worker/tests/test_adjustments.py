from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from backtest.adjustments import AdjustmentUnavailable, adjust_total_return_bars
from backtest.corporate_actions import CorporateActionRecord
from backtest.models import Bar


def daily(day: int, close: str, *, volume: str = "100") -> Bar:
    value = Decimal(close)
    return Bar(
        asset="FPT",
        timestamp=datetime(2025, 1, day, 0, tzinfo=timezone.utc),
        timeframe="1d",
        open=value,
        high=value,
        low=value,
        close=value,
        volume=Decimal(volume),
        source="vnstock-vci-free",
    )


def action(**kwargs) -> CorporateActionRecord:
    return CorporateActionRecord(
        asset="FPT",
        provider_code="vnstock-vci-free",
        provider_event_id=kwargs.pop("provider_event_id", "event-1"),
        action_type=kwargs.pop("action_type"),
        status=kwargs.pop("status", "verified"),
        ex_right_date=kwargs.pop("ex_right_date", date(2025, 1, 3)),
        source_payload={},
        **kwargs,
    )


def test_cash_dividend_adjusts_only_pre_ex_date_prices() -> None:
    result = adjust_total_return_bars(
        [daily(2, "100"), daily(3, "90"), daily(6, "95")],
        [action(action_type="cash_dividend", cash_per_share=Decimal("10"))],
        coverage_complete=True,
    )

    assert [row.close for row in result.rows] == [Decimal("90"), Decimal("90"), Decimal("95")]
    assert result.policy == "total_return"


def test_stock_dividend_and_rights_issue_use_theoretical_ex_price_factor() -> None:
    result = adjust_total_return_bars(
        [daily(2, "100", volume="100"), daily(3, "75", volume="130")],
        [
            action(
                provider_event_id="stock",
                action_type="stock_dividend",
                distribution_ratio=Decimal("0.2"),
            ),
            action(
                provider_event_id="rights",
                action_type="rights_issue",
                subscription_ratio=Decimal("0.1"),
                subscription_price=Decimal("50"),
            ),
        ],
        coverage_complete=True,
    )

    assert result.rows[0].close.quantize(Decimal("0.00000001")) == Decimal("80.76923077")
    assert result.rows[0].volume.quantize(Decimal("0.0001")) == Decimal("123.8095")
    assert result.rows[1].close == Decimal("75")


def test_adjusted_dataset_is_blocked_when_action_coverage_is_incomplete() -> None:
    with pytest.raises(AdjustmentUnavailable, match="coverage"):
        adjust_total_return_bars([daily(2, "100"), daily(3, "90")], [], coverage_complete=False)


def test_unverified_action_never_changes_prices() -> None:
    result = adjust_total_return_bars(
        [daily(2, "100"), daily(3, "90")],
        [
            action(
                action_type="cash_dividend",
                cash_per_share=Decimal("10"),
                status="unverified",
            )
        ],
        coverage_complete=True,
    )

    assert [row.close for row in result.rows] == [Decimal("100"), Decimal("90")]
    assert result.skipped_unverified == 1


def test_cash_dividend_is_converted_from_vnd_to_vnstock_thousand_vnd_price_units() -> None:
    result = adjust_total_return_bars(
        [daily(2, "13.5"), daily(3, "12.5")],
        [action(action_type="cash_dividend", cash_per_share=Decimal("1000"))],
        coverage_complete=True,
        cash_value_scale=Decimal("1000"),
    )

    assert result.rows[0].close == Decimal("12.5000000000000000000000000000000000")
