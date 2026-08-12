from backtest.signal_jobs import enqueue_strategy_evaluations


class FakeCursor:
    def __init__(self) -> None:
        self.sql = ""
        self.params: tuple[object, ...] = ()
        self.rowcount = 0

    def execute(self, sql: str, params: tuple[object, ...]) -> None:
        self.sql = sql
        self.params = params
        self.rowcount = 2


def test_enqueue_targets_only_active_assignments_for_published_asset() -> None:
    cursor = FakeCursor()
    count = enqueue_strategy_evaluations(cursor, "dataset-v2", "asset-btc")
    assert count == 2
    assert cursor.params == ("dataset-v2", "asset-btc")
    assert "assignment.status = 'active'" in cursor.sql
    assert "version.status = 'active'" in cursor.sql
    assert "ON CONFLICT (assignment_id, dataset_version_id) DO NOTHING" in cursor.sql


def test_enqueue_is_scoped_to_matching_asset_timeframe_and_eligible_data() -> None:
    cursor = FakeCursor()
    enqueue_strategy_evaluations(cursor, "dataset-v3", "asset-xau")
    assert "assignment.asset_id = %s" in cursor.sql
    assert "assignment.asset_id = dataset.asset_id" in cursor.sql
    assert "run.timeframe = dataset.timeframe" in cursor.sql
    assert "published.quality_status IN ('passed', 'warning')" in cursor.sql
