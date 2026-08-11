from datetime import datetime, timedelta, timezone
from decimal import Decimal

from backtest.models import Bar
from backtest.signal_evaluator import ActiveAssignment, evaluate_latest_signal


def test_latest_assignment_signal_uses_live_position_and_dataset_provenance() -> None:
    closes = [10, 9, 8, 7, 8, 9]
    bars = [
        Bar(
            asset="BTC",
            timestamp=datetime(2025, 1, 1, tzinfo=timezone.utc) + timedelta(days=index),
            timeframe="1d",
            open=Decimal(close),
            high=Decimal(close) + 1,
            low=Decimal(close) - 1,
            close=Decimal(close),
            volume=Decimal("100"),
            source="test",
        )
        for index, close in enumerate(closes)
    ]
    assignment = ActiveAssignment(
        assignment_id="assignment",
        organization_id="org",
        asset_id="asset",
        strategy_version_id="strategy",
        strategy_code="ema_trend",
        strategy_version="1.0.0",
        parameters={"fastPeriod": 2, "slowPeriod": 4},
        position_quantity=Decimal("0"),
    )

    signal = evaluate_latest_signal(assignment, bars, dataset_version_id="dataset-v2")

    assert signal is not None
    assert signal["signalType"] == "buy"
    assert signal["signalAt"] == bars[-1].timestamp
    assert signal["metadata"]["datasetVersionId"] == "dataset-v2"
