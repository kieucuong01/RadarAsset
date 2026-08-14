from __future__ import annotations

from backtest.capacity import build_capacity_report, percentile


def test_percentile_uses_nearest_rank_with_interpolation() -> None:
    assert percentile([], 0.95) is None
    assert percentile([1.0], 0.95) == 1.0
    assert percentile([1.0, 2.0, 3.0, 4.0], 0.5) == 2.5
    assert percentile([1.0, 2.0, 3.0, 4.0], 0.95) == 3.85


def test_capacity_report_keeps_only_sanitized_aggregates() -> None:
    report = build_capacity_report(
        requested=20,
        workers=8,
        rows=[
            {"status": "succeeded", "queue_seconds": 1.0, "run_seconds": 2.0},
            {"status": "cancelled", "queue_seconds": 2.0, "run_seconds": None},
            {"status": "timed_out", "queue_seconds": None, "run_seconds": None},
        ],
        artifact_ownership_violations=0,
        elapsed_seconds=3.5,
        retries=1,
    )

    assert report["terminalCounts"] == {"cancelled": 1, "succeeded": 1, "timed_out": 1}
    assert report["queueSeconds"] == {"p50": 1.5, "p95": 1.95}
    assert report["runSeconds"] == {"p50": 2.0, "p95": 2.0}
    assert report["artifactOwnershipViolations"] == 0
    assert "rows" not in report
