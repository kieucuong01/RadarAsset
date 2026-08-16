from datetime import date

from publish_adjusted_datasets import (
    _coverage_contains_raw,
    _deactivate_adjusted_dataset,
    _load_candidates,
)


class Cursor:
    rowcount = 1

    def execute(self, query, params):
        self.query = query
        self.params = params

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


class Connection:
    def __init__(self):
        self.value = Cursor()

    def cursor(self):
        return self.value


class CandidateCursor(Cursor):
    def __init__(self):
        self.rows = [{"symbol": "FPT", "timeframe": "1d"}]

    def fetchall(self):
        return self.rows


class CandidateConnection:
    def __init__(self):
        self.value = CandidateCursor()

    def cursor(self, **_kwargs):
        return self.value


def test_unsafe_adjusted_dataset_is_deactivated_by_asset_and_timeframe() -> None:
    connection = Connection()

    assert _deactivate_adjusted_dataset(connection, "FPT", "1d") == 1
    assert "dataset.adjustment_policy = 'total_return'" in connection.value.query
    assert "version.is_active = true" in connection.value.query
    assert connection.value.params == ("FPT", "1d")


def test_action_coverage_dates_must_contain_raw_range() -> None:
    action_start = date(2025, 1, 2)
    action_end = date(2025, 1, 3)
    raw_start = date(2025, 1, 1)
    raw_end = date(2025, 1, 4)

    assert not _coverage_contains_raw(action_start, action_end, raw_start, raw_end)
    assert _coverage_contains_raw(raw_start, raw_end, raw_start, raw_end)


def test_adjusted_candidates_are_limited_to_daily_scope_and_daily_timeframe() -> None:
    connection = CandidateConnection()

    candidates = _load_candidates(connection, ("FPT", "VCB"))

    assert candidates == [{"symbol": "FPT", "timeframe": "1d"}]
    assert "dataset.timeframe = '1d'" in connection.value.query
    assert "asset.symbol = ANY(%s::text[])" in connection.value.query
    assert connection.value.params == (["FPT", "VCB"],)
