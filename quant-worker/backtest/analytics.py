from __future__ import annotations

import math
import tempfile
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path
from typing import Any, Iterable

import matplotlib
import pandas as pd

matplotlib.use("Agg")
import quantstats as qs

from .market_calendar import annualization_factor


@dataclass(frozen=True)
class PerformanceAnalytics:
    metrics: dict[str, Any]
    html: str


def _finite(value: Any) -> float | None:
    result = float(value)
    return round(result, 4) if math.isfinite(result) else None


def _metrics(returns: pd.Series, periods: int) -> dict[str, float | None]:
    prices = (1 + returns).cumprod()
    return {
        "cagrPct": None if len(returns) < 2 else _finite(qs.stats.cagr(returns, periods=periods) * 100),
        "volatilityPct": _finite(qs.stats.volatility(returns, periods=periods) * 100),
        "sharpe": _finite(qs.stats.sharpe(returns, periods=periods)),
        "sortino": _finite(qs.stats.sortino(returns, periods=periods)),
        "maxDrawdownPct": _finite(qs.stats.max_drawdown(prices) * 100),
        "calmar": _finite(qs.stats.calmar(returns, periods=periods)),
        "cvarPct": _finite(qs.stats.cvar(returns) * 100),
    }


def _returns(equity: Iterable[dict[str, Any]]) -> pd.Series:
    frame = pd.DataFrame(equity)
    if not {"timestamp", "equity"}.issubset(frame.columns):
        raise ValueError("Equity artifact is invalid.")
    index = pd.to_datetime(frame["timestamp"], utc=True)
    values = pd.Series(pd.to_numeric(frame["equity"], errors="raise").to_numpy(), index=index)
    if (values <= 0).any() or values.index.has_duplicates or not values.index.is_monotonic_increasing:
        raise ValueError("Equity artifact must be positive, unique and chronological.")
    return values.pct_change().dropna()


def build_performance_analytics(
    equity: list[dict[str, Any]],
    *,
    markets: list[str],
    timeframe: str,
    title: str,
) -> PerformanceAnalytics:
    returns = _returns(equity)
    if len(returns) < 30:
        raise ValueError("Performance analytics requires at least 30 returns.")
    if not markets:
        raise ValueError("At least one market is required.")
    periods = round(sum(annualization_factor(market, timeframe) for market in markets) / len(markets))
    split = max(1, int(len(returns) * 0.7))
    train = returns.iloc[:split]
    test = returns.iloc[split:]
    metrics = {
        "source": {
            "library": "quantstats",
            "version": version("quantstats"),
            "repository": "https://github.com/ranaroussi/quantstats",
            "license": "Apache-2.0",
        },
        "split": "chronological_70_30",
        "annualizationFactor": periods,
        "trainObservationCount": len(train),
        "testObservationCount": len(test),
        "inSample": _metrics(train, periods),
        "outOfSample": _metrics(test, periods),
        "fullPeriod": _metrics(returns, periods),
    }

    temporary = tempfile.NamedTemporaryFile(suffix=".html", delete=False)
    path = Path(temporary.name)
    temporary.close()
    try:
        qs.reports.html(
            returns,
            title=title,
            output=str(path),
            periods_per_year=periods,
            download_filename="quantstats-report.html",
        )
        html = path.read_text(encoding="utf-8")
    finally:
        path.unlink(missing_ok=True)
    return PerformanceAnalytics(metrics=metrics, html=html)
