from __future__ import annotations

import math
from statistics import mean, pstdev
from typing import Any


def _return_pct(start: float, end: float) -> float:
    return round((end / start - 1) * 100, 4) if start > 0 else 0.0


def out_of_sample_return(equity: list[dict[str, Any]], *, fraction: float = 0.3) -> float:
    if not 0 < fraction < 1 or len(equity) < 4:
        raise ValueError("Out-of-sample inputs are invalid.")
    rows = sorted(equity, key=lambda row: str(row["timestamp"]))
    values = [float(row["equity"]) for row in rows]
    if any(not math.isfinite(value) or value <= 0 for value in values):
        raise ValueError("Out-of-sample equity must be finite and positive.")
    split_index = max(1, min(len(values) - 2, round((len(values) - 1) * (1 - fraction))))
    return _return_pct(values[split_index], values[-1])


def parameter_neighbors(
    parameters: dict[str, Any],
    *,
    validator: Any,
    limit: int = 4,
) -> list[dict[str, Any]]:
    if not 1 <= limit <= 8:
        raise ValueError("Parameter neighbor limit is invalid.")
    candidates: list[dict[str, Any]] = []
    for name in sorted(parameters):
        value = parameters[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if isinstance(value, int):
            delta: int | float = max(1, round(abs(value) * 0.1))
        else:
            delta = max(0.01, abs(value) * 0.1)
        for direction in (-1, 1):
            neighbor = {**parameters, name: value + direction * delta}
            if isinstance(value, int):
                neighbor[name] = int(neighbor[name])
            else:
                neighbor[name] = round(float(neighbor[name]), 8)
            try:
                validator(neighbor)
            except (TypeError, ValueError):
                continue
            if neighbor not in candidates:
                candidates.append(neighbor)
            if len(candidates) == limit:
                return candidates
    return candidates


def build_walk_forward_diagnostics(equity: list[dict[str, Any]], *, folds: int = 3) -> dict[str, Any]:
    if not 2 <= folds <= 10 or len(equity) < folds * 4:
        raise ValueError("Walk-forward inputs are invalid.")
    rows = sorted(equity, key=lambda row: str(row["timestamp"]))
    timestamps = [str(row["timestamp"]) for row in rows]
    values = [float(row["equity"]) for row in rows]
    if any(not math.isfinite(value) or value <= 0 for value in values):
        raise ValueError("Walk-forward equity must be finite and positive.")
    return_count = len(rows) - 1
    train_returns = max(1, return_count // 2)
    remaining = return_count - train_returns
    test_size = remaining // folds
    if test_size < 1:
        raise ValueError("Walk-forward sample is too small.")
    fold_rows: list[dict[str, Any]] = []
    for index in range(folds):
        train_end = train_returns + index * test_size
        test_end = return_count if index == folds - 1 else train_end + test_size
        train_return = _return_pct(values[0], values[train_end])
        test_return = _return_pct(values[train_end], values[test_end])
        fold_rows.append({
            "fold": index + 1,
            "trainStart": timestamps[0],
            "trainEnd": timestamps[train_end],
            "testStart": timestamps[train_end + 1],
            "testEnd": timestamps[test_end],
            "trainObservationCount": train_end,
            "testObservationCount": test_end - train_end,
            "referenceReturnPct": train_return,
            "outOfSampleReturnPct": test_return,
            "degradationPctPoints": round(test_return - train_return, 4),
        })
    oos_returns = [float(row["outOfSampleReturnPct"]) for row in fold_rows]
    positive_pct = round(sum(value > 0 for value in oos_returns) / len(oos_returns) * 100, 2)
    adequate = min(row["testObservationCount"] for row in fold_rows) >= 20
    warnings: list[str] = []
    if not adequate:
        warnings.append("INSUFFICIENT_OOS_SAMPLE")
    if positive_pct < 50:
        warnings.append("OOS_INSTABILITY")
    return {
        "method": "anchored_temporal_holdout",
        "foldCount": folds,
        "folds": fold_rows,
        "outOfSampleMeanReturnPct": round(mean(oos_returns), 4),
        "outOfSampleReturnStdPct": round(pstdev(oos_returns), 4),
        "outOfSamplePositiveFoldPct": positive_pct,
        "sampleAdequacy": "adequate" if adequate else "insufficient",
        "warnings": warnings,
        "disclaimer": "Temporal holdout diagnostic; it does not fit or select parameters inside each fold.",
    }


def parameter_stability(*, base_oos_return: float, neighbor_oos_returns: list[float]) -> dict[str, Any]:
    if not neighbor_oos_returns:
        return {"status": "not_evaluated", "score": None, "warnings": ["NO_PARAMETER_NEIGHBORS"]}
    scale = max(1.0, abs(base_oos_return))
    dispersion = pstdev([base_oos_return, *neighbor_oos_returns])
    sign_consistency = sum((value >= 0) == (base_oos_return >= 0) for value in neighbor_oos_returns) / len(neighbor_oos_returns)
    score = round(max(0.0, min(100.0, 100 * sign_consistency - 25 * dispersion / scale)), 2)
    status = "stable" if score >= 70 else "mixed" if score >= 40 else "fragile"
    return {"status": status, "score": score, "neighborCount": len(neighbor_oos_returns), "warnings": [] if status != "fragile" else ["PARAMETER_SENSITIVITY"]}


def build_walk_forward_selection(
    candidates: dict[str, list[dict[str, Any]]], *, folds: int = 3
) -> dict[str, Any]:
    if not candidates:
        raise ValueError("Walk-forward candidates are required.")
    normalized: dict[str, tuple[list[str], list[float]]] = {}
    reference_timestamps: list[str] | None = None
    for name, equity in candidates.items():
        rows = sorted(equity, key=lambda row: str(row["timestamp"]))
        timestamps = [str(row["timestamp"]) for row in rows]
        values = [float(row["equity"]) for row in rows]
        if len(rows) < folds * 4 or any(not math.isfinite(value) or value <= 0 for value in values):
            raise ValueError("Walk-forward candidate inputs are invalid.")
        if reference_timestamps is not None and timestamps != reference_timestamps:
            raise ValueError("Walk-forward candidates must share timestamps.")
        reference_timestamps = timestamps
        normalized[name] = (timestamps, values)
    assert reference_timestamps is not None
    return_count = len(reference_timestamps) - 1
    train_returns = max(1, return_count // 2)
    test_size = (return_count - train_returns) // folds
    if test_size < 1:
        raise ValueError("Walk-forward sample is too small.")
    fold_rows: list[dict[str, Any]] = []
    for index in range(folds):
        train_end = train_returns + index * test_size
        test_end = return_count if index == folds - 1 else train_end + test_size
        ranked = sorted(
            (
                (_return_pct(values[0], values[train_end]), name, values)
                for name, (_, values) in normalized.items()
            ),
            key=lambda item: (-item[0], item[1]),
        )
        train_return, selected_name, selected_values = ranked[0]
        test_return = _return_pct(selected_values[train_end], selected_values[test_end])
        fold_rows.append({
            "fold": index + 1,
            "trainStart": reference_timestamps[0],
            "trainEnd": reference_timestamps[train_end],
            "testStart": reference_timestamps[train_end + 1],
            "testEnd": reference_timestamps[test_end],
            "trainObservationCount": train_end,
            "testObservationCount": test_end - train_end,
            "selectedCandidate": selected_name,
            "referenceReturnPct": train_return,
            "outOfSampleReturnPct": test_return,
            "degradationPctPoints": round(test_return - train_return, 4),
        })
    oos_returns = [float(row["outOfSampleReturnPct"]) for row in fold_rows]
    positive_pct = round(sum(value > 0 for value in oos_returns) / len(oos_returns) * 100, 2)
    adequate = min(row["testObservationCount"] for row in fold_rows) >= 20
    warnings = ([] if adequate else ["INSUFFICIENT_OOS_SAMPLE"]) + ([] if positive_pct >= 50 else ["OOS_INSTABILITY"])
    return {
        "method": "anchored_walk_forward_selection",
        "candidateCount": len(candidates),
        "foldCount": folds,
        "folds": fold_rows,
        "outOfSampleMeanReturnPct": round(mean(oos_returns), 4),
        "outOfSampleReturnStdPct": round(pstdev(oos_returns), 4),
        "outOfSamplePositiveFoldPct": positive_pct,
        "sampleAdequacy": "adequate" if adequate else "insufficient",
        "warnings": warnings,
        "disclaimer": "Anchored walk-forward selection; each fold selects a bounded candidate on prior data and evaluates it only on the next unseen window.",
    }


def combined_robustness_status(
    *, sample_adequacy: str, positive_fold_pct: float, parameter_status: str
) -> dict[str, Any]:
    warnings: list[str] = []
    if sample_adequacy != "adequate":
        warnings.append("INSUFFICIENT_OOS_SAMPLE")
    if positive_fold_pct < 50:
        warnings.append("OOS_INSTABILITY")
    if parameter_status == "fragile":
        warnings.append("PARAMETER_SENSITIVITY")
    if parameter_status == "not_evaluated":
        return {"status": "not_evaluated", "warnings": warnings or ["NO_PARAMETER_NEIGHBORS"]}
    if "OOS_INSTABILITY" in warnings or "PARAMETER_SENSITIVITY" in warnings:
        return {"status": "fragile", "warnings": warnings}
    if warnings or positive_fold_pct < 75 or parameter_status == "mixed":
        return {"status": "mixed", "warnings": warnings}
    return {"status": "stable", "warnings": warnings}
