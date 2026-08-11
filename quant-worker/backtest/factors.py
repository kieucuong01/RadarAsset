from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _percentile(series: pd.Series, *, ascending: bool = True) -> pd.Series:
    return series.rank(method="average", pct=True, ascending=ascending) * 100


def rank_vietnam_factors(
    prices: pd.DataFrame,
    volumes: pd.DataFrame,
    *,
    as_of: str,
) -> dict[str, Any]:
    if prices.shape != volumes.shape or list(prices.columns) != list(volumes.columns):
        raise ValueError("Factor price and volume matrices must align.")
    if prices.shape[0] < 252 or prices.shape[1] < 5:
        raise ValueError("Factor Lab requires at least 5 VN assets with 252 aligned sessions.")
    if prices.isna().any().any() or volumes.isna().any().any():
        raise ValueError("Factor matrices cannot contain missing values.")
    if (prices <= 0).any().any() or (volumes < 0).any().any():
        raise ValueError("Factor matrices contain invalid market values.")

    returns = prices.pct_change().dropna()
    momentum = prices.iloc[-1] / prices.iloc[-127] - 1
    volatility = returns.iloc[-63:].std(ddof=1) * np.sqrt(252)
    trend = prices.iloc[-1] / prices.iloc[-50:].mean() - 1
    liquidity = (prices.iloc[-20:] * volumes.iloc[-20:]).mean()
    scores = pd.DataFrame(
        {
            "momentum": _percentile(momentum),
            "lowVolatility": _percentile(volatility, ascending=False),
            "trend": _percentile(trend),
            "liquidity": _percentile(liquidity),
        }
    )
    scores["composite"] = scores.mean(axis=1)
    rows = []
    for symbol in scores.sort_values(["composite"], ascending=False).index:
        rows.append(
            {
                "symbol": str(symbol),
                "compositeScore": round(float(scores.loc[symbol, "composite"]), 2),
                "momentumScore": round(float(scores.loc[symbol, "momentum"]), 2),
                "lowVolatilityScore": round(float(scores.loc[symbol, "lowVolatility"]), 2),
                "trendScore": round(float(scores.loc[symbol, "trend"]), 2),
                "liquidityScore": round(float(scores.loc[symbol, "liquidity"]), 2),
                "momentum126dPct": round(float(momentum[symbol] * 100), 2),
                "volatility63dPct": round(float(volatility[symbol] * 100), 2),
            }
        )
    return {
        "asOf": as_of,
        "universeSize": len(rows),
        "observationCount": len(prices),
        "methodology": "point_in_time_price_volume_v1",
        "rows": rows,
    }
