from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from smart_insights.asset_opinion_repository import load_asset_opinion_market_data


NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)


class FakeCursor:
    def __init__(self, connection: "CountingConnection") -> None:
        self.connection = connection
        self.rows: list[dict[str, object]] = []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, query: str, parameters: object) -> None:
        self.connection.execute_count += 1
        self.connection.queries.append(query)
        self.rows = (
            self.connection.bar_rows
            if self.connection.execute_count == 1
            else self.connection.fact_rows
        )

    def fetchall(self) -> list[dict[str, object]]:
        return self.rows


class CountingConnection:
    def __init__(
        self,
        *,
        bar_rows: list[dict[str, object]] | None = None,
        fact_rows: list[dict[str, object]] | None = None,
    ) -> None:
        self.execute_count = 0
        self.queries: list[str] = []
        self.bar_rows = bar_rows or []
        self.fact_rows = fact_rows or []

    def cursor(self, **kwargs: object) -> FakeCursor:
        return FakeCursor(self)


def bar_row(symbol: str, index: int, *, future: bool = False) -> dict[str, object]:
    ts = NOW + timedelta(days=1) if future else NOW - timedelta(days=1)
    return {
        "id": f"bar-{symbol}-{index}",
        "asset_symbol": symbol,
        "ts": ts,
        "close": Decimal(100 + index),
        "observed_at": ts,
    }


def fact_row(
    symbol: str | None,
    metric_code: str,
    *,
    methodology: str = "crypto-regime-v1",
) -> dict[str, object]:
    return {
        "id": f"fact-{symbol or 'global'}-{metric_code}",
        "asset_symbol": symbol,
        "metric_code": metric_code,
        "value": Decimal("12.5"),
        "unit": "USD million",
        "effective_at": NOW,
        "observed_at": NOW,
        "provider_code": "farside",
        "source_url": "https://farside.co.uk",
        "methodology_version": methodology,
        "freshness_sla_minutes": 4_320,
        "quality_status": "passed",
        "direction": 1,
        "signal_score": Decimal("35"),
        "critical": False,
    }


def test_batch_loader_uses_two_queries_for_one_or_twenty_five_assets() -> None:
    one = CountingConnection()
    many = CountingConnection()

    load_asset_opinion_market_data(one, ("BTC",), ("BTC",), NOW)
    load_asset_opinion_market_data(
        many,
        tuple(f"A{index}" for index in range(25)),
        ("VNINDEX",),
        NOW,
    )

    assert one.execute_count == 2
    assert many.execute_count == 2
    assert "ROW_NUMBER() OVER" in many.queries[0]
    assert "jsonb_array_elements" in many.queries[1]


def test_batch_loader_groups_bars_and_global_facts_without_future_or_kronos() -> None:
    connection = CountingConnection(
        bar_rows=[bar_row("BTC", 1), bar_row("XAU", 2), bar_row("BTC", 3, future=True)],
        fact_rows=[
            fact_row("BTC", "crypto.etf.net_flow_usd"),
            fact_row(None, "macro.real_yield.10y_pct"),
            fact_row("BTC", "kronos.btc.forecast", methodology="kronos-btc-shadow-v1"),
        ],
    )

    result = load_asset_opinion_market_data(connection, ("BTC", "XAU"), ("BTC", "XAU"), NOW)

    assert tuple(row.id for row in result.bars_for("BTC")) == ("bar-BTC-1",)
    assert tuple(row.metric_code for row in result.facts_for("BTC")) == (
        "crypto.etf.net_flow_usd",
        "macro.real_yield.10y_pct",
    )
    assert tuple(row.metric_code for row in result.facts_for("XAU")) == (
        "macro.real_yield.10y_pct",
    )


def test_batch_loader_rejects_more_than_twenty_five_opinion_assets() -> None:
    with pytest.raises(ValueError, match="at most 25"):
        load_asset_opinion_market_data(
            CountingConnection(),
            tuple(f"A{index}" for index in range(26)),
            ("VNINDEX",),
            NOW,
        )
