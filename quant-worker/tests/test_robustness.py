from datetime import datetime, timedelta, timezone

from backtest.robustness import (
    build_walk_forward_diagnostics,
    out_of_sample_return,
    parameter_neighbors,
    parameter_stability,
    build_walk_forward_selection,
    combined_robustness_status,
)


def equity(values: list[float]) -> list[dict[str, object]]:
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return [{"timestamp": (start + timedelta(days=index)).isoformat(), "equity": value} for index, value in enumerate(values)]


def test_temporal_holdout_uses_expanding_reference_and_future_only_test_windows() -> None:
    result = build_walk_forward_diagnostics(equity([100 + index for index in range(121)]), folds=3)

    assert result["method"] == "anchored_temporal_holdout"
    assert len(result["folds"]) == 3
    assert all(fold["trainEnd"] < fold["testStart"] for fold in result["folds"])
    assert [fold["testObservationCount"] for fold in result["folds"]] == [20, 20, 20]
    assert result["outOfSamplePositiveFoldPct"] == 100.0
    assert result["sampleAdequacy"] == "adequate"


def test_walk_forward_flags_small_or_unstable_samples() -> None:
    result = build_walk_forward_diagnostics(equity([100 + ((-1) ** index) * index for index in range(45)]), folds=3)

    assert result["sampleAdequacy"] == "insufficient"
    assert "INSUFFICIENT_OOS_SAMPLE" in result["warnings"]


def test_parameter_stability_penalizes_neighbor_collapse() -> None:
    stable = parameter_stability(base_oos_return=10, neighbor_oos_returns=[9, 11, 8, 10])
    fragile = parameter_stability(base_oos_return=10, neighbor_oos_returns=[-20, -10, 35, -30])

    assert stable["status"] == "stable"
    assert stable["score"] > fragile["score"]
    assert fragile["status"] == "fragile"
    assert "PARAMETER_SENSITIVITY" in fragile["warnings"]


def test_parameter_stability_is_explicit_when_no_neighbors_exist() -> None:
    assert parameter_stability(base_oos_return=5, neighbor_oos_returns=[])["status"] == "not_evaluated"


def test_parameter_neighbors_are_bounded_valid_one_parameter_perturbations() -> None:
    def validator(parameters: dict[str, object]) -> None:
        if not 2 <= parameters["fast"] < parameters["slow"] <= 20:
            raise ValueError("invalid")

    result = parameter_neighbors({"fast": 5, "slow": 10}, validator=validator, limit=4)

    assert len(result) == 4
    assert all(sum(candidate[key] != {"fast": 5, "slow": 10}[key] for key in candidate) == 1 for candidate in result)
    assert all(2 <= candidate["fast"] < candidate["slow"] <= 20 for candidate in result)


def test_out_of_sample_return_uses_only_the_chronological_tail() -> None:
    rows = equity([100, 200, 300, 400, 500, 550])

    assert out_of_sample_return(rows, fraction=0.3) == 10.0


def test_walk_forward_reselects_the_best_training_candidate_for_each_future_fold() -> None:
    base = equity([100, 105, 110, 115, 120, 121, 122, 123, 124, 125, 126, 127, 128])
    neighbor = equity([100, 101, 102, 103, 104, 110, 120, 130, 140, 150, 160, 170, 180])

    result = build_walk_forward_selection({"base": base, "neighbor-1": neighbor}, folds=2)

    assert result["method"] == "anchored_walk_forward_selection"
    assert result["candidateCount"] == 2
    assert [fold["selectedCandidate"] for fold in result["folds"]] == ["base", "neighbor-1"]
    assert all(fold["trainEnd"] < fold["testStart"] for fold in result["folds"])


def test_combined_robustness_marks_unstable_oos_or_parameter_sensitivity_fragile() -> None:
    assert combined_robustness_status(
        sample_adequacy="adequate",
        positive_fold_pct=33,
        parameter_status="stable",
    )["status"] == "fragile"
    assert combined_robustness_status(
        sample_adequacy="adequate",
        positive_fold_pct=100,
        parameter_status="fragile",
    ) == {"status": "fragile", "warnings": ["PARAMETER_SENSITIVITY"]}
