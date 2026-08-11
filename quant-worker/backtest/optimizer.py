from __future__ import annotations

from dataclasses import dataclass
from importlib.metadata import version
from math import sqrt
from typing import Any

import numpy as np
import pandas as pd
from skfolio import RiskMeasure
from skfolio.optimization import (
    EqualWeighted,
    HierarchicalEqualRiskContribution,
    HierarchicalRiskParity,
    InverseVolatility,
    MaximumDiversification,
    MeanRisk,
    ObjectiveFunction,
    RiskBudgeting,
)


MIN_OBSERVATIONS = 30


@dataclass(frozen=True)
class OptimizerRequest:
    returns: pd.DataFrame
    method: str
    max_weight: float
    total_weight: float
    annualization_by_symbol: dict[str, int]
    target_return_pct: float | None = None
    target_volatility_pct: float | None = None
    risk_tolerance: float | None = None


def _estimator(request: OptimizerRequest, annualization: float):
    shared = {"max_weights": request.max_weight}
    if request.method == "equal_weight":
        return EqualWeighted()
    if request.method == "inverse_volatility":
        return InverseVolatility()
    if request.method == "minimum_variance":
        return MeanRisk(risk_measure=RiskMeasure.VARIANCE, **shared)
    if request.method == "maximum_sharpe":
        return MeanRisk(
            objective_function=ObjectiveFunction.MAXIMIZE_RATIO,
            risk_measure=RiskMeasure.STANDARD_DEVIATION,
            **shared,
        )
    if request.method == "target_return":
        if request.target_return_pct is None:
            raise ValueError("Target return is required.")
        return MeanRisk(
            risk_measure=RiskMeasure.VARIANCE,
            min_return=request.target_return_pct / 100 / annualization,
            **shared,
        )
    if request.method == "target_volatility":
        if request.target_volatility_pct is None or request.target_volatility_pct <= 0:
            raise ValueError("Target volatility is required.")
        return MeanRisk(
            objective_function=ObjectiveFunction.MAXIMIZE_RETURN,
            risk_measure=RiskMeasure.STANDARD_DEVIATION,
            max_standard_deviation=request.target_volatility_pct / 100 / sqrt(annualization),
            **shared,
        )
    if request.method == "risk_tolerance":
        if request.risk_tolerance is None or request.risk_tolerance <= 0:
            raise ValueError("Risk tolerance is required.")
        return MeanRisk(
            objective_function=ObjectiveFunction.MAXIMIZE_UTILITY,
            risk_measure=RiskMeasure.VARIANCE,
            risk_aversion=1 / request.risk_tolerance,
            **shared,
        )
    if request.method == "risk_parity":
        return RiskBudgeting(risk_measure=RiskMeasure.VARIANCE, **shared)
    if request.method == "most_diversified":
        return MaximumDiversification(**shared)
    if request.method == "minimum_correlation":
        return HierarchicalEqualRiskContribution(**shared)
    if request.method == "minimum_cvar":
        return MeanRisk(risk_measure=RiskMeasure.CVAR, **shared)
    if request.method == "hierarchical_risk_parity":
        return HierarchicalRiskParity(risk_measure=RiskMeasure.VARIANCE, **shared)
    raise ValueError(f"Unsupported optimizer method: {request.method}.")


def _normalized_weights(raw: Any, total: float, maximum: float) -> np.ndarray:
    weights = np.asarray(raw, dtype=float)
    if weights.ndim != 1 or not np.isfinite(weights).all() or (weights < -1e-8).any():
        raise ValueError("Optimizer returned invalid weights.")
    weights = np.maximum(weights, 0)
    if weights.sum() <= 0:
        raise ValueError("Optimizer returned zero weights.")
    weights = weights / weights.sum() * total
    while (weights > maximum + 1e-12).any():
        capped = weights >= maximum
        excess = float(np.maximum(weights[capped] - maximum, 0).sum())
        weights[capped] = maximum
        available = ~capped
        if not available.any() or float((maximum - weights[available]).sum()) + 1e-12 < excess:
            raise ValueError("Optimizer cannot satisfy the maximum-weight constraint.")
        base = weights[available]
        if float(base.sum()) <= 1e-12:
            addition = np.full(base.shape, excess / len(base))
        else:
            addition = excess * base / float(base.sum())
        weights[available] += addition
    return weights


def _basis_points(symbols: list[str], weights: np.ndarray, total_bps: int, max_bps: int):
    raw = weights / weights.sum() * total_bps
    result = np.floor(raw).astype(int)
    remainder = total_bps - int(result.sum())
    order = sorted(range(len(symbols)), key=lambda i: (-(raw[i] - result[i]), symbols[i]))
    while remainder:
        changed = False
        for index in order:
            if result[index] < max_bps:
                result[index] += 1
                remainder -= 1
                changed = True
                if remainder == 0:
                    break
        if not changed:
            raise ValueError("Unable to round allocation within the maximum-weight constraint.")
    return {symbol: int(result[index]) for index, symbol in enumerate(symbols)}


def _metrics(frame: pd.DataFrame, weights: np.ndarray, annualization: float) -> dict[str, float | None]:
    series = frame.to_numpy(dtype=float) @ (weights / weights.sum())
    mean = float(np.mean(series)) if len(series) else 0.0
    volatility = float(np.std(series, ddof=1)) if len(series) > 1 else 0.0
    equity = np.cumprod(1 + series)
    peaks = np.maximum.accumulate(equity) if len(equity) else np.array([1.0])
    max_drawdown = float(np.min(equity / peaks - 1)) if len(equity) else 0.0
    return {
        "expectedReturnPct": round(mean * annualization * 100, 2),
        "volatilityPct": round(volatility * sqrt(annualization) * 100, 2),
        "sharpe": None if volatility <= 1e-12 else round(mean / volatility * sqrt(annualization), 4),
        "maxDrawdownPct": round(max_drawdown * 100, 2),
    }


def optimize(request: OptimizerRequest) -> dict[str, Any]:
    frame = request.returns.copy()
    if not 1 <= frame.shape[1] <= 10:
        raise ValueError("Expected 1 to 10 assets.")
    if len(frame) < MIN_OBSERVATIONS:
        raise ValueError("Optimizer requires at least 30 aligned observations.")
    if frame.isna().any().any() or not np.isfinite(frame.to_numpy(dtype=float)).all():
        raise ValueError("Return series must be finite and aligned.")
    symbols = sorted(str(column) for column in frame.columns)
    frame = frame[symbols]
    if set(symbols) != set(request.annualization_by_symbol):
        raise ValueError("Annualization inputs do not match return symbols.")
    if not 0 < request.total_weight <= 1 or not 0 < request.max_weight <= 1:
        raise ValueError("Weight constraints must be between zero and one.")
    if request.max_weight * len(symbols) + 1e-9 < request.total_weight:
        raise ValueError("Maximum asset weight cannot satisfy the portfolio total.")

    split = max(MIN_OBSERVATIONS, int(len(frame) * 0.7))
    if split >= len(frame):
        split = len(frame) - 1
    train = frame.iloc[:split]
    test = frame.iloc[split:]
    annualization = float(np.mean([request.annualization_by_symbol[symbol] for symbol in symbols]))
    estimator = _estimator(request, annualization)
    estimator.fit(train)
    weights = _normalized_weights(estimator.weights_, request.total_weight, request.max_weight)
    total_bps = round(request.total_weight * 10_000)
    max_bps = round(request.max_weight * 10_000)
    weights_bps = _basis_points(symbols, weights, total_bps, max_bps)
    effective = np.array([weights_bps[symbol] / 10_000 for symbol in symbols], dtype=float)

    means = frame.mean()
    volatility = frame.std(ddof=1)
    correlation = frame.corr().fillna(0)
    asset_metrics = [
        {
            "symbol": symbol,
            "expectedReturnPct": round(
                float(means[symbol]) * request.annualization_by_symbol[symbol] * 100, 2
            ),
            "volatilityPct": round(
                float(volatility[symbol]) * sqrt(request.annualization_by_symbol[symbol]) * 100,
                2,
            ),
        }
        for symbol in symbols
    ]
    correlation_matrix = [
        {
            "symbol": symbol,
            "correlations": {
                other: round(1.0 if symbol == other else float(correlation.loc[symbol, other]), 4)
                for other in symbols
            },
        }
        for symbol in symbols
    ]
    full_metrics = _metrics(frame, effective, annualization)
    return {
        "method": request.method,
        "source": {
            "library": "skfolio",
            "version": version("skfolio"),
            "repository": "https://github.com/skfolio/skfolio",
            "directory": "awesome-quant: Portfolio Optimization & Risk Analysis",
            "license": "BSD-3-Clause",
        },
        "weightsBps": weights_bps,
        "expectedReturnPct": full_metrics["expectedReturnPct"],
        "volatilityPct": full_metrics["volatilityPct"],
        "sharpe": full_metrics["sharpe"],
        "observationCount": len(frame),
        "assetMetrics": asset_metrics,
        "correlationMatrix": correlation_matrix,
        "validation": {
            "split": "chronological_70_30",
            "trainObservationCount": len(train),
            "testObservationCount": len(test),
            "inSample": _metrics(train, effective, annualization),
            "outOfSample": _metrics(test, effective, annualization),
        },
        "warnings": [],
    }
