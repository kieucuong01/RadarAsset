from datetime import datetime, timezone
from decimal import Decimal

from smart_insights.opinion_evaluation import (
    OpinionEvaluation,
    load_pending_evaluations,
    load_price_points,
    persist_evaluation,
)


class Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.query = ""
        self.params = ()
        self.rowcount = 1

    def execute(self, query, params):
        self.query = query
        self.params = params

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


class Connection:
    def __init__(self, rows):
        self.value = Cursor(rows)

    def cursor(self, **_kwargs):
        return self.value


def test_pending_loader_is_bounded_directional_and_tenant_attributed() -> None:
    connection = Connection([])

    assert load_pending_evaluations(connection, limit=250) == []
    assert "signal.signal_type = 'asset_opinion'" in connection.value.query
    assert "signal.status = 'active'" in connection.value.query
    assert "horizon_sessions" in connection.value.query
    assert "organizationId" in connection.value.query
    assert "NOT EXISTS" in connection.value.query
    assert connection.value.params == (250,)


def test_vn_price_loader_prefers_adjusted_daily_then_raw_fallback() -> None:
    connection = Connection(
        [
            {
                "symbol": "FPT",
                "ts": datetime(2026, 8, 14, tzinfo=timezone.utc),
                "close": Decimal("100"),
                "dataset_version_id": "version-1",
                "adjustment_policy": "total_return",
            }
        ]
    )

    points = load_price_points(connection, "FPT", "vn_equity")

    assert points[0].adjustment_policy == "total_return"
    assert "dataset.timeframe = '1d'" in connection.value.query
    assert "'total_return'" in connection.value.query
    assert "'raw'" in connection.value.query
    assert connection.value.params == ("FPT", "vn_equity")


def test_persistence_is_idempotent_on_signal_and_horizon() -> None:
    connection = Connection([])
    now = datetime(2026, 8, 16, tzinfo=timezone.utc)
    evaluation = OpinionEvaluation(
        signal_snapshot_id="11111111-1111-4111-8111-111111111111",
        organization_id="22222222-2222-4222-8222-222222222222",
        user_id="33333333-3333-4333-8333-333333333333",
        asset_symbol="ETH",
        benchmark_symbol="BTC",
        horizon_sessions=5,
        direction=1,
        entry_timestamp=now,
        entry_close=Decimal("100"),
        target_timestamp=now,
        target_close=Decimal("110"),
        benchmark_entry_close=Decimal("200"),
        benchmark_target_close=Decimal("210"),
        asset_return=Decimal("0.1"),
        benchmark_return=Decimal("0.05"),
        excess_return=Decimal("0.05"),
        correct=True,
        asset_dataset_version_id="44444444-4444-4444-8444-444444444444",
        benchmark_dataset_version_id="55555555-5555-4555-8555-555555555555",
        adjustment_policy="raw",
    )

    assert persist_evaluation(connection, evaluation, evaluated_at=now) == 1
    assert "ON CONFLICT (signal_snapshot_id, horizon_sessions) DO NOTHING" in connection.value.query
    assert "JOIN assets AS benchmark" in connection.value.query
