from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import importlib

from smart_insights.metrics.crypto import ObservationPoint


NOW = datetime(2026, 8, 14, 12, tzinfo=timezone.utc)


class FakeRepository:
    def __init__(self, rows: list[ObservationPoint]) -> None:
        self.rows = rows
        self.definitions = ()

    def upsert_metric_definitions(self, definitions: tuple[object, ...]) -> None:
        self.definitions = definitions

    def metric_observations(
        self, metric_code: str, *, as_of: datetime, limit: int = 5_000
    ) -> tuple[ObservationPoint, ...]:
        return tuple(
            row
            for row in self.rows
            if row.metric_code == metric_code
            and row.effective_at <= as_of
            and row.observed_at <= as_of
        )[-limit:]


def observation(
    code: str,
    value: str,
    effective_at: datetime,
    *,
    address: str | None = None,
    provider: str = "mempool-btc-large-addresses",
    dimensions: dict[str, str] | None = None,
) -> ObservationPoint:
    row_dimensions = dict(dimensions or {})
    if address is not None:
        row_dimensions["address"] = address
    key = f"{code}:{effective_at.isoformat()}:{address or row_dimensions}"
    return ObservationPoint(
        id=key,
        metric_code=code,
        value=Decimal(value),
        effective_at=effective_at,
        observed_at=effective_at + timedelta(hours=1),
        provider_code=provider,
        quality_status="passed",
        natural_key=key,
        revision=1,
        dimensions=row_dimensions,
        asset_symbol="BTC",
    )


def daily_rows(days: int, *, coverage: str = "1") -> list[ObservationPoint]:
    rows: list[ObservationPoint] = []
    start = NOW - timedelta(days=days)
    for index in range(days):
        current = start + timedelta(days=index)
        rows.extend(
            (
                observation(
                    "crypto.large_address.confirmed_balance_btc",
                    str(1_000 + index * 20),
                    current,
                    address="bc1q0000000000000000000000000000000000001",
                ),
                observation(
                    "crypto.large_address.confirmed_balance_btc",
                    "2000",
                    current,
                    address="bc1q1111111111111111111111111111111111111",
                ),
                observation(
                    "crypto.large_address.to_exchange_btc", "5", current
                ),
                observation(
                    "crypto.large_address.from_exchange_btc", "10", current
                ),
                observation(
                    "crypto.large_address.address_coverage", coverage, current
                ),
                observation(
                    "crypto.large_address.transaction_coverage", coverage, current
                ),
                observation(
                    "crypto.large_address.flow_label_coverage", coverage, current
                ),
            )
        )
    rows.append(
        observation(
            "crypto.large_address.address_balance_btc",
            "120000",
            NOW - timedelta(hours=12),
            address="bc1q0000000000000000000000000000000000001",
            provider="bitinfocharts-top-addresses",
            dimensions={"cohort_version": "cohort-v1"},
        )
    )
    return rows


def test_common_cohort_excludes_membership_churn_and_applies_material_threshold() -> None:
    module = importlib.import_module("smart_insights.large_address_metrics")

    result = module.common_cohort_metrics(
        previous={
            "a": Decimal("1000"),
            "b": Decimal("20000"),
            "c": Decimal("5000"),
            "exit": Decimal("1500"),
        },
        current={
            "a": Decimal("1011"),
            "b": Decimal("20019"),
            "c": Decimal("4989"),
            "entrant": Decimal("1800"),
        },
    )

    assert result.net_accumulation_btc == Decimal("19")
    assert result.accumulating_count == 1
    assert result.distributing_count == 1
    assert result.unchanged_count == 1
    assert result.accumulation_breadth == Decimal("0.333333")
    assert result.distribution_breadth == Decimal("0.333333")
    assert result.entrant_count == 1
    assert result.exit_count == 1


def test_action_score_requires_30_valid_daily_changes_then_calibrates() -> None:
    module = importlib.import_module("smart_insights.large_address_metrics")

    insufficient = module.calculate_large_address_snapshot(
        FakeRepository(daily_rows(30)), as_of=NOW
    )
    eligible = module.calculate_large_address_snapshot(
        FakeRepository(daily_rows(31)), as_of=NOW
    )

    assert insufficient.score is None
    assert insufficient.label == "calibrating"
    assert eligible.score == Decimal("0.0000")
    assert eligible.label == "neutral"
    assert eligible.status == "active"
    assert eligible.data_confidence == Decimal("100.00")


def test_action_score_is_withheld_when_data_confidence_is_below_60() -> None:
    module = importlib.import_module("smart_insights.large_address_metrics")

    snapshot = module.calculate_large_address_snapshot(
        FakeRepository(daily_rows(31, coverage="0.20")), as_of=NOW
    )

    assert snapshot.score is None
    assert snapshot.label == "unavailable"
    assert snapshot.status == "unavailable"
    assert snapshot.data_confidence < Decimal("60")
