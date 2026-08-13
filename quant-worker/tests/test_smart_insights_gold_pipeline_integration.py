from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from smart_insights.gold_pipeline import calculate_gold_snapshot, run_gold_pipeline
from smart_insights.metrics.crypto import (
    MarketClose,
    ObservationPoint,
    SignalSnapshotInput,
)
from smart_insights.metrics.gold import METHODOLOGY_VERSION


NOW = datetime(2026, 8, 13, 23, 59, 59, tzinfo=timezone.utc)


class FakeRepository:
    def __init__(self) -> None:
        self.published: list[SignalSnapshotInput] = []
        self.definitions: tuple[object, ...] = ()

    def upsert_metric_definitions(self, definitions: tuple[object, ...]) -> None:
        self.definitions = definitions

    def price_closes(
        self, asset_symbol: str, *, as_of: datetime, limit: int = 500
    ) -> tuple[MarketClose, ...]:
        assert asset_symbol == "XAU"
        rows = tuple(
            MarketClose(
                id=f"xau:{index}",
                asset_symbol="XAU",
                ts=(NOW - timedelta(days=150 - index)).replace(
                    hour=0, minute=0, second=0, microsecond=0
                ),
                close=Decimal("2000") + Decimal(index * 2),
                observed_at=(
                    NOW - timedelta(hours=1)
                    if index == 149
                    else NOW - timedelta(days=150 - index) + timedelta(hours=1)
                ),
            )
            for index in range(150)
        )
        return tuple(row for row in rows if row.observed_at <= as_of)[-limit:]

    def metric_observations(
        self, metric_code: str, *, as_of: datetime, limit: int = 5_000
    ) -> tuple[ObservationPoint, ...]:
        if metric_code in {"macro.real_yield.10y_pct", "macro.usd_broad_index"}:
            count, spacing, provider = 100, 1, "fred"
        elif metric_code == "gold.etf_flow_tonnes":
            count, spacing, provider = 30, 30, "wgc-gold-etf"
        elif metric_code == "gold.central_bank_net_purchase_tonnes":
            count, spacing, provider = 30, 30, "wgc-central-bank"
        elif metric_code == "gold.cftc.managed_money_net_oi":
            count, spacing, provider = 40, 7, "cftc-disaggregated"
        else:
            return ()
        output = []
        for index in range(count):
            effective_at = (NOW - timedelta(days=(count - index) * spacing)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            latest = index == count - 1
            observed_at = (
                NOW - timedelta(hours=2)
                if latest
                else effective_at + timedelta(hours=12)
            )
            output.append(
                ObservationPoint(
                    id=f"{metric_code}:{index}",
                    metric_code=metric_code,
                    value=(
                        Decimal(100 + index)
                        if provider == "fred"
                        else Decimal(index - count // 2)
                    ),
                    effective_at=effective_at,
                    observed_at=observed_at,
                    provider_code=provider,
                    quality_status="passed",
                    natural_key=f"{metric_code}:{index}",
                    revision=1,
                    dimensions={"frequency": "source_period"} if "wgc" in provider else {},
                    asset_symbol="XAU" if provider.startswith("wgc") else None,
                )
            )
        return tuple(row for row in output if row.observed_at <= as_of)[-limit:]

    def latest_signal_snapshot(
        self, *, market: str, as_of: datetime
    ) -> dict[str, Any] | None:
        return None

    def publish_signal_snapshot(
        self, snapshot: SignalSnapshotInput
    ) -> tuple[str, str]:
        self.published.append(snapshot)
        return "gold-snapshot", "succeeded"


def test_gold_pipeline_is_deterministic_coverage_gated_and_replayable() -> None:
    repository = FakeRepository()
    first = calculate_gold_snapshot(repository, as_of=NOW)
    replay = calculate_gold_snapshot(repository, as_of=NOW)

    assert first.methodology_version == METHODOLOGY_VERSION
    assert first.status == "active"
    assert first.coverage == Decimal("1.0000")
    assert first.score is not None
    assert {row.metric_code for row in first.inputs} == {
        "gold.group.momentum",
        "gold.group.real_yields",
        "gold.group.usd_pressure",
        "gold.group.etf_flow",
        "gold.group.cftc_positioning",
        "gold.group.central_bank_demand",
    }
    assert first.idempotency_key == replay.idempotency_key
    assert first.inputs == replay.inputs


def test_gold_pipeline_ignores_future_observations_in_replay() -> None:
    class FutureRepository(FakeRepository):
        def metric_observations(
            self, metric_code: str, *, as_of: datetime, limit: int = 5_000
        ) -> tuple[ObservationPoint, ...]:
            rows = super().metric_observations(metric_code, as_of=as_of, limit=limit)
            if not rows:
                return rows
            future = ObservationPoint(
                id="future",
                metric_code=metric_code,
                value=Decimal("999999"),
                effective_at=as_of + timedelta(days=1),
                observed_at=as_of + timedelta(days=1),
                provider_code=rows[-1].provider_code,
                quality_status="passed",
                natural_key="future",
                revision=1,
            )
            return rows + tuple(row for row in (future,) if row.observed_at <= as_of)

    assert calculate_gold_snapshot(FakeRepository(), as_of=NOW).idempotency_key == (
        calculate_gold_snapshot(FutureRepository(), as_of=NOW).idempotency_key
    )


def test_gold_pipeline_publishes_regime_snapshot() -> None:
    repository = FakeRepository()
    result = run_gold_pipeline(repository, as_of=NOW)

    assert result.snapshot.status == "active"
    assert repository.published[0].signal_type == "regime"
