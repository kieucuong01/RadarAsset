import math

import pandas as pd
import pytest

from backtest.optimizer import OptimizerRequest, _normalized_weights, optimize


def returns_frame(rows: int = 120) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "BTC": [0.002 * math.sin(index / 5) + 0.0005 for index in range(rows)],
            "FPT": [0.0015 * math.cos(index / 7) + 0.0003 for index in range(rows)],
            "XAU": [0.0008 * math.sin(index / 11) + 0.00015 for index in range(rows)],
        }
    )


@pytest.mark.parametrize(
    "method",
    [
        "equal_weight",
        "inverse_volatility",
        "minimum_variance",
        "maximum_sharpe",
        "risk_tolerance",
        "risk_parity",
        "most_diversified",
        "minimum_correlation",
        "minimum_cvar",
        "hierarchical_risk_parity",
    ],
)
def test_optimizer_enforces_caps_and_reports_untouched_oos(method: str) -> None:
    result = optimize(
        OptimizerRequest(
            returns=returns_frame(),
            method=method,
            max_weight=0.6,
            total_weight=0.8,
            annualization_by_symbol={"BTC": 365, "FPT": 252, "XAU": 260},
            risk_tolerance=2,
        )
    )

    assert sum(result["weightsBps"].values()) == 8_000
    assert max(result["weightsBps"].values()) <= 6_000
    assert result["observationCount"] == 120
    assert result["validation"]["trainObservationCount"] == 84
    assert result["validation"]["testObservationCount"] == 36
    assert result["validation"]["split"] == "chronological_70_30"
    assert set(result["validation"]["inSample"]) == {
        "expectedReturnPct",
        "volatilityPct",
        "sharpe",
        "maxDrawdownPct",
    }
    assert set(result["validation"]["outOfSample"]) == set(result["validation"]["inSample"])
    assert result["source"]["library"] == "skfolio"


def test_target_methods_require_and_honor_bounded_inputs() -> None:
    with pytest.raises(ValueError, match="Target return"):
        optimize(
            OptimizerRequest(
                returns=returns_frame(),
                method="target_return",
                max_weight=0.6,
                total_weight=1,
                annualization_by_symbol={"BTC": 365, "FPT": 252, "XAU": 260},
            )
        )


def test_optimizer_rejects_too_little_history() -> None:
    with pytest.raises(ValueError, match="30"):
        optimize(
            OptimizerRequest(
                returns=returns_frame(29),
                method="minimum_variance",
                max_weight=1,
                total_weight=1,
                annualization_by_symbol={"BTC": 365, "FPT": 252, "XAU": 260},
            )
        )


def test_weight_normalization_redistributes_an_uncapped_estimator_result() -> None:
    weights = _normalized_weights([0.99, 0.01], total=1, maximum=0.6)

    assert weights.tolist() == pytest.approx([0.6, 0.4])
