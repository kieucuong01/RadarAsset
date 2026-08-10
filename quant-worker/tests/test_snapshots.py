from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from backtest.models import Bar
from backtest.snapshots import ActiveSnapshot, merge_snapshot


def bar(
    hour: int,
    close: str,
    *,
    asset: str = "BTC",
    source: str = "binance-public-spot",
) -> Bar:
    close_value = Decimal(close)
    return Bar(
        asset=asset,
        timestamp=datetime(2026, 8, 10, hour, tzinfo=timezone.utc),
        timeframe="1h",
        open=close_value,
        high=close_value + 1,
        low=close_value - 1,
        close=close_value,
        volume=Decimal("10"),
        source=source,
    )


def test_merge_snapshot_keeps_history_and_replaces_a_matching_timestamp() -> None:
    merged = merge_snapshot(
        [bar(0, "10"), bar(1, "11")],
        [bar(1, "12"), bar(2, "13")],
        overlap_start=datetime(2026, 8, 10, 1, tzinfo=timezone.utc),
    )

    assert [(row.timestamp.hour, row.close) for row in merged] == [
        (0, Decimal("10")),
        (1, Decimal("12")),
        (2, Decimal("13")),
    ]


def test_merge_snapshot_rejects_an_empty_provider_window() -> None:
    with pytest.raises(ValueError, match="at least one incoming bar"):
        merge_snapshot(
            [bar(0, "10")],
            [],
            overlap_start=datetime(2026, 8, 10, tzinfo=timezone.utc),
        )


def test_merge_snapshot_rejects_mixed_assets() -> None:
    with pytest.raises(ValueError, match="one asset and timeframe"):
        merge_snapshot(
            [bar(0, "10")],
            [bar(1, "12", asset="XAU")],
            overlap_start=datetime(2026, 8, 10, tzinfo=timezone.utc),
        )


@pytest.mark.parametrize(
    ("source_metadata", "source"),
    [
        ({"mode": "fixture"}, "binance-public-spot"),
        ({"mode": "live"}, "research_fixture"),
    ],
)
def test_active_snapshot_detects_fixture_provenance(
    source_metadata: dict[str, str], source: str
) -> None:
    snapshot = ActiveSnapshot(
        dataset_id="dataset-1",
        dataset_version_id="version-1",
        version=1,
        checksum="a" * 64,
        source_metadata=source_metadata,
        rows=(bar(0, "10", source=source),),
    )

    assert snapshot.is_fixture is True
