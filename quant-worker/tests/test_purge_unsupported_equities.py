from __future__ import annotations

import pytest

from purge_unsupported_equities import (
    discover_unsupported_assets,
    purge_unsupported_equities,
)


TARGETS = [
    {
        "id": "11111111-1111-4111-8111-111111111111",
        "symbol": "SPY",
        "asset_class": "etf",
        "market": "other",
    },
    {
        "id": "22222222-2222-4222-8222-222222222222",
        "symbol": "NVDA",
        "asset_class": "equity",
        "market": "other",
    },
]


class Cursor:
    def __init__(self, targets, *, fail_delete=False):
        self.targets = list(targets)
        self.fail_delete = fail_delete
        self.calls = []
        self.rowcount = 0
        self._rows = []

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.calls.append((normalized, params))
        if normalized.startswith("SELECT id, symbol, asset_class, market FROM assets"):
            self._rows = list(self.targets)
            self.rowcount = len(self.targets)
        elif normalized.startswith("SELECT COUNT(*)::int AS count"):
            self._rows = [{"count": 1}]
            self.rowcount = 1
        elif normalized.startswith("DELETE FROM assets"):
            if self.fail_delete:
                raise RuntimeError("unexpected foreign key")
            self.rowcount = len(self.targets)
            self._rows = []
        else:
            self.rowcount = 1
            self._rows = []

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


class Connection:
    def __init__(self, targets=TARGETS, *, fail_delete=False):
        self.value = Cursor(targets, fail_delete=fail_delete)
        self.commits = 0
        self.rollbacks = 0

    def cursor(self, **_kwargs):
        return self.value

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_discovery_selects_equity_and_etf_only_outside_vietnam() -> None:
    connection = Connection()

    assets = discover_unsupported_assets(connection)

    assert [row.symbol for row in assets] == ["SPY", "NVDA"]
    query = connection.value.calls[0][0]
    assert "LOWER(asset_class) IN ('equity', 'etf', 'stock')" in query
    assert "market <> 'vn_equity'" in query


def test_dry_run_reports_dependencies_without_writes_or_commit() -> None:
    connection = Connection()

    report = purge_unsupported_equities(connection, apply=False)

    assert report["mode"] == "dry-run"
    assert report["assetCount"] == 2
    assert report["symbols"] == ["SPY", "NVDA"]
    assert report["dependencyCounts"]
    assert all(not query.startswith("DELETE") for query, _ in connection.value.calls)
    assert connection.commits == 0


def test_apply_deletes_dependencies_then_assets_in_one_commit() -> None:
    connection = Connection()

    report = purge_unsupported_equities(connection, apply=True)

    delete_queries = [query for query, _ in connection.value.calls if query.startswith("DELETE")]
    assert report["mode"] == "apply"
    assert report["deletedAssetCount"] == 2
    assert delete_queries[-1].startswith("DELETE FROM assets")
    assert connection.commits == 1
    assert connection.rollbacks == 0


def test_apply_is_idempotent_when_no_targets_remain() -> None:
    connection = Connection(targets=[])

    report = purge_unsupported_equities(connection, apply=True)

    assert report == {
        "mode": "apply",
        "assetCount": 0,
        "deletedAssetCount": 0,
        "dependencyCounts": {},
        "symbols": [],
    }
    assert connection.commits == 0


def test_apply_rolls_back_on_an_unexpected_dependency() -> None:
    connection = Connection(fail_delete=True)

    with pytest.raises(RuntimeError, match="unexpected foreign key"):
        purge_unsupported_equities(connection, apply=True)

    assert connection.commits == 0
    assert connection.rollbacks == 1
