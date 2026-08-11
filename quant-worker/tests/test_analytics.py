from datetime import datetime, timedelta, timezone

from backtest.analytics import build_performance_analytics


def equity_curve(rows: int = 90) -> list[dict]:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    value = 1000.0
    result = []
    for index in range(rows):
        value *= 1 + (0.004 if index % 5 else -0.006)
        result.append(
            {
                "timestamp": (start + timedelta(days=index)).isoformat().replace("+00:00", "Z"),
                "equity": value,
            }
        )
    return result


def test_quantstats_analytics_contains_is_oos_metrics_and_html() -> None:
    result = build_performance_analytics(
        equity_curve(),
        markets=["crypto_spot"],
        timeframe="1d",
        title="BTC strategy",
    )

    assert result.metrics["split"] == "chronological_70_30"
    assert result.metrics["trainObservationCount"] == 62
    assert result.metrics["testObservationCount"] == 27
    assert result.metrics["source"]["library"] == "quantstats"
    assert "sharpe" in result.metrics["inSample"]
    assert "maxDrawdownPct" in result.metrics["outOfSample"]
    assert "<!doctype html" in result.html.lower()
    assert "BTC strategy" in result.html
