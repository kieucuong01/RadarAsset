from __future__ import annotations

from collections import Counter
from typing import Any, Iterable


def percentile(values: Iterable[float], quantile: float) -> float | None:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return None
    if not 0 <= quantile <= 1:
        raise ValueError("quantile must be between zero and one")
    position = (len(ordered) - 1) * quantile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return round(ordered[lower] + (ordered[upper] - ordered[lower]) * fraction, 4)


def _timings(rows: list[dict[str, Any]], key: str) -> dict[str, float | None]:
    values = [float(row[key]) for row in rows if row.get(key) is not None]
    return {"p50": percentile(values, 0.5), "p95": percentile(values, 0.95)}


def build_capacity_report(
    *,
    requested: int,
    workers: int,
    rows: list[dict[str, Any]],
    artifact_ownership_violations: int,
    elapsed_seconds: float,
    retries: int,
) -> dict[str, Any]:
    return {
        "requestedRuns": requested,
        "workerThreads": workers,
        "terminalCounts": dict(sorted(Counter(str(row["status"]) for row in rows).items())),
        "queueSeconds": _timings(rows, "queue_seconds"),
        "runSeconds": _timings(rows, "run_seconds"),
        "elapsedSeconds": round(elapsed_seconds, 4),
        "retries": retries,
        "artifactOwnershipViolations": artifact_ownership_violations,
    }
