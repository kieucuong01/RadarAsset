import pandas as pd
import pytest

from backtest.factors import rank_vietnam_factors


def matrices(asset_count: int = 5, observations: int = 252):
    prices = pd.DataFrame(
        {
            f"VN{asset}": [100 + asset * 5 + index * (asset + 1) / 100 for index in range(observations)]
            for asset in range(asset_count)
        }
    )
    volumes = pd.DataFrame(
        {f"VN{asset}": [1000 + asset * 100 for _ in range(observations)] for asset in range(asset_count)}
    )
    return prices, volumes


def test_factor_lab_ranks_point_in_time_vietnam_universe() -> None:
    prices, volumes = matrices()
    result = rank_vietnam_factors(prices, volumes, as_of="2026-08-12")
    assert result["universeSize"] == 5
    assert result["observationCount"] == 252
    assert result["rows"][0]["compositeScore"] >= result["rows"][-1]["compositeScore"]
    assert result["methodology"] == "point_in_time_price_volume_v1"


def test_factor_lab_fails_closed_before_data_threshold() -> None:
    prices, volumes = matrices(asset_count=4)
    with pytest.raises(ValueError, match="5 VN assets"):
        rank_vietnam_factors(prices, volumes, as_of="2026-08-12")
