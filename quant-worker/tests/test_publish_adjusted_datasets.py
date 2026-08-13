from datetime import date

from publish_adjusted_datasets import _coverage_contains_raw, _deactivate_adjusted_dataset


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
