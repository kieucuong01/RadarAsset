from datetime import datetime, timezone
from decimal import Decimal

from backtest.custom_execution import run_scheduled_dca
from backtest.custom_rules import ScheduledDcaRule
from backtest.models import Bar


def test_monthly_dca_uses_first_available_bar_on_or_after_schedule() -> None:
    dates = [(2026, 1, 15), (2026, 1, 16), (2026, 2, 16), (2026, 3, 17)]
    bars = [
        Bar(
            asset="BTC",
            timestamp=datetime(year, month, day, tzinfo=timezone.utc),
            timeframe="1d",
            open=Decimal("100"),
            high=Decimal("100"),
            low=Decimal("100"),
            close=Decimal("100"),
            volume=Decimal("1"),
            source="test",
        )
        for year, month, day in dates
    ]

    result = run_scheduled_dca(
        "BTC",
        bars,
        initial_capital=Decimal("1000"),
        rule=ScheduledDcaRule(Decimal("400"), "USD", 15),
        fee_bps=Decimal("0"),
        slippage_bps=Decimal("0"),
        strategy_hash="a" * 64,
        dataset_checksum="b" * 64,
    )

    assert [row["amount"] for row in result.contributions] == [400.0, 400.0, 400.0]
    assert [row["executedAt"] for row in result.contributions] == [
        "2026-01-15T00:00:00Z",
        "2026-02-16T00:00:00Z",
        "2026-03-17T00:00:00Z",
    ]
    assert result.result.summary["cumulativeContributions"] == 1200.0
    assert result.result.summary["netProfitExcludingContributions"] == 0.0
