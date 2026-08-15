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
    effective_at: datetime = NOW,
    dimensions: dict[str, str] | None = None,
    value: str = "12.5",
) -> dict[str, object]:
    resolved_dimensions = dimensions or (
        {"asset": "BTC", "fund": "TOTAL"}
        if metric_code == "crypto.etf.net_flow_usd"
        else {"asset": "total"}
        if metric_code == "crypto.coinshares.net_flow_usd"
        else {}
    )
    return {
        "id": f"fact-{symbol or 'global'}-{metric_code}",
        "asset_symbol": symbol,
        "metric_code": metric_code,
        "value": Decimal(value),
        "unit": "USD million",
        "effective_at": effective_at,
        "observed_at": NOW,
        "provider_code": "farside",
        "source_url": "https://farside.co.uk",
        "methodology_version": methodology,
        "freshness_sla_minutes": 4_320,
        "quality_status": "passed",
        "direction": 1,
        "signal_score": Decimal("35"),
        "signal_metric_code": metric_code,
        "signal_market": "crypto" if metric_code.startswith("crypto.") else "macro",
        "signal_percentile": Decimal("0.675"),
        "signal_configured_weight": Decimal("0.25"),
        "raw_percentile": None,
        "raw_history_count": 0,
        "dimensions": resolved_dimensions,
        "critical": False,
    }


def test_batch_loader_uses_two_queries_for_one_or_twenty_five_assets() -> None:
    one = CountingConnection()
    many = CountingConnection()

    load_asset_opinion_market_data(one, (("BTC", "crypto"),), ("BTC",), NOW)
    load_asset_opinion_market_data(
        many,
        tuple((f"A{index}", "equity") for index in range(25)),
        ("VNINDEX",),
        NOW,
    )

    assert one.execute_count == 2
    assert many.execute_count == 2
    assert "ROW_NUMBER() OVER" in many.queries[0]
    assert "dataset.adjustment_policy IN ('raw', 'total_return')" in many.queries[0]
    assert "PARTITION BY asset.id" in many.queries[0]
    assert "selected.dataset_rank = 1" in many.queries[0]
    assert "jsonb_array_elements" in many.queries[1]
    assert "jsonb_typeof(signal.inputs) = 'array'" in many.queries[1]
    assert "signal_scores AS" in many.queries[1]
    assert "PARTITION BY source_observation_id" in many.queries[1]
    assert "LEFT JOIN LATERAL" not in many.queries[1]
    assert "metric.code = ANY(%s)" in many.queries[1]
    assert "PARTITION BY fact_scope, metric_code" in many.queries[1]
    assert "metric_rank <= 100" in many.queries[1]
    assert "LIMIT 1000" not in many.queries[1]


def test_batch_loader_groups_bars_and_global_facts_without_future_or_kronos() -> None:
    connection = CountingConnection(
        bar_rows=[bar_row("BTC", 1), bar_row("XAU", 2), bar_row("BTC", 3, future=True)],
        fact_rows=[
            fact_row("BTC", "crypto.etf.net_flow_usd"),
            fact_row(None, "macro.real_yield.10y_pct"),
            fact_row("BTC", "kronos.btc.forecast", methodology="kronos-btc-shadow-v1"),
        ],
    )

    result = load_asset_opinion_market_data(
        connection, (("BTC", "crypto"), ("XAU", "gold")), ("BTC", "XAU"), NOW
    )

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
            tuple((f"A{index}", "equity") for index in range(26)),
            ("VNINDEX",),
            NOW,
        )


def test_batch_loader_deduplicates_same_symbol_and_trading_date() -> None:
    first = bar_row("BTC", 1)
    replacement = {**bar_row("BTC", 2), "observed_at": NOW}
    connection = CountingConnection(bar_rows=[first, replacement])

    result = load_asset_opinion_market_data(
        connection, (("BTC", "crypto"),), ("BTC",), NOW
    )

    assert tuple(row.id for row in result.bars_for("BTC")) == ("bar-BTC-2",)


def test_loader_scopes_global_facts_by_market_and_keeps_latest_metric() -> None:
    older = fact_row(
        None,
        "crypto.fear_greed.index",
        effective_at=NOW - timedelta(days=1),
        dimensions={"classification": "fear"},
    )
    older["id"] = "fear-greed-older"
    latest = fact_row(
        None,
        "crypto.fear_greed.index",
        dimensions={"classification": "greed"},
    )
    latest["id"] = "fear-greed-latest"
    macro = fact_row(None, "macro.real_yield.10y_pct")
    connection = CountingConnection(fact_rows=[older, latest, macro])

    result = load_asset_opinion_market_data(
        connection,
        (("BTC", "crypto"), ("XAU", "gold"), ("VNINDEX", "equity")),
        ("BTC", "XAU", "VNINDEX"),
        NOW,
    )

    assert [
        row.id
        for row in result.facts_for("BTC")
        if row.metric_code == "crypto.fear_greed.index"
    ] == ["fear-greed-latest"]
    assert all(
        not row.metric_code.startswith("crypto.")
        for row in result.facts_for("XAU")
    )
    assert all(
        not row.metric_code.startswith("crypto.")
        for row in result.facts_for("VNINDEX")
    )
    assert "macro.real_yield.10y_pct" in {
        row.metric_code for row in result.facts_for("BTC")
    }
    assert "macro.real_yield.10y_pct" in {
        row.metric_code for row in result.facts_for("XAU")
    }
    assert "macro.real_yield.10y_pct" not in {
        row.metric_code for row in result.facts_for("VNINDEX")
    }


def test_loader_marks_backfilled_old_effective_data_stale() -> None:
    historical = fact_row(
        None,
        "crypto.fear_greed.index",
        effective_at=NOW - timedelta(days=30),
        dimensions={"classification": "fear"},
    )
    historical["observed_at"] = NOW

    result = load_asset_opinion_market_data(
        CountingConnection(fact_rows=[historical]),
        (("BTC", "crypto"),),
        ("BTC",),
        NOW,
    )

    assert result.facts_for("BTC")[0].fresh is False


def test_loader_normalizes_unscored_farside_from_90_day_percentile() -> None:
    etf = fact_row("BTC", "crypto.etf.net_flow_usd")
    etf["signal_score"] = None
    etf["signal_percentile"] = None
    etf["raw_percentile"] = Decimal("0.8")
    etf["raw_history_count"] = 15

    result = load_asset_opinion_market_data(
        CountingConnection(fact_rows=[etf]),
        (("BTC", "crypto"),),
        ("BTC",),
        NOW,
    )

    fact = result.facts_for("BTC")[0]
    assert fact.signed_score == Decimal("60.0")
    assert fact.percentile == Decimal("0.8")
    assert fact.normalization_method == "empirical_percentile_90d"


def test_loader_excludes_noise_and_caps_latest_decision_facts() -> None:
    approved = (
        "crypto.etf.net_flow_usd",
        "crypto.coinshares.net_flow_usd",
        "crypto.fear_greed.index",
        "crypto.onchain.adjusted_transfer_usd",
        "crypto.onchain.active_addresses",
        "crypto.onchain.nvt",
        "crypto.network.hashrate_hs",
        "crypto.large_address.exchange_flow_pressure_btc",
        "macro.real_yield.10y_pct",
        "macro.usd_broad_index",
        "macro.fed_balance_sheet_change_4w",
        "macro.reverse_repo_change_4w",
        "macro.tga_change_4w",
        "macro.growth_surprise",
        "macro.inflation_surprise",
    )
    rows = [fact_row(None, "crypto.cycle.altcoin_season.index")]
    rows.extend(fact_row(None, code) for code in approved)

    result = load_asset_opinion_market_data(
        CountingConnection(fact_rows=rows),
        (("BTC", "crypto"),),
        ("BTC",),
        NOW,
    )

    assert all(
        row.metric_code != "crypto.cycle.altcoin_season.index"
        for row in result.facts_for("BTC")
    )
    assert len(result.facts_for("BTC")) == 12


def test_loader_keeps_only_90_day_altcoin_season_horizon() -> None:
    rows = []
    for horizon, value in (("season_90d", "25"), ("month", "80"), ("year", "90")):
        row = fact_row(
            None,
            "crypto.cycle.altcoin_season.index",
            dimensions={"horizon": horizon},
            value=value,
        )
        row["id"] = f"altseason-{horizon}"
        rows.append(row)

    result = load_asset_opinion_market_data(
        CountingConnection(fact_rows=rows),
        (("ADA", "crypto"),),
        ("BTC",),
        NOW,
    )

    rotation = tuple(
        row
        for row in result.facts_for("ADA")
        if row.metric_code == "crypto.cycle.altcoin_season.index"
    )
    assert len(rotation) == 1
    assert dict(rotation[0].dimensions) == {"horizon": "season_90d"}
    assert rotation[0].value == Decimal("25")


def test_loader_scopes_global_etf_rows_to_requested_asset_dimension() -> None:
    rows = []
    for asset, value in (("ETH", "10"), ("SOL", "20")):
        row = fact_row(
            None,
            "crypto.etf.net_flow_usd",
            dimensions={"asset": asset, "fund": "TOTAL"},
            value=value,
        )
        row["id"] = f"etf-{asset.lower()}"
        rows.append(row)

    result = load_asset_opinion_market_data(
        CountingConnection(fact_rows=rows),
        (("ETH", "crypto"), ("SOL", "crypto"), ("ADA", "crypto")),
        ("BTC",),
        NOW,
    )

    assert dict(result.facts_for("ETH")[0].dimensions)["asset"] == "ETH"
    assert dict(result.facts_for("SOL")[0].dimensions)["asset"] == "SOL"
    assert all(row.metric_code != "crypto.etf.net_flow_usd" for row in result.facts_for("ADA"))


def test_loader_derives_latest_m2_four_week_percent_change_from_real_history() -> None:
    rows = []
    for index in range(24):
        effective_at = NOW - timedelta(weeks=23 - index)
        row = fact_row(
            None,
            "macro.m2_busd",
            effective_at=effective_at,
            value=str(Decimal("20000") + Decimal("100") * index),
        )
        row.update(
            id=f"m2-{index}",
            unit="USD billion",
            provider_code="fred",
            source_url="https://fred.stlouisfed.org/series/M2SL",
            signal_score=None,
            signal_percentile=None,
            raw_percentile=None,
            raw_history_count=24,
        )
        rows.append(row)

    result = load_asset_opinion_market_data(
        CountingConnection(fact_rows=rows),
        (("ADA", "crypto"),),
        ("BTC",),
        NOW,
    )

    liquidity = next(
        row for row in result.facts_for("ADA") if row.metric_code == "macro.m2_change_4w"
    )
    assert liquidity.value == Decimal("22300") / Decimal("21900") - Decimal("1")
    assert liquidity.signed_score is not None
    assert liquidity.normalization_method == "empirical_percentile_365d"
    assert liquidity.underlying_ids == ("m2-19", "m2-23")
    assert liquidity.source_code == "fred"


def test_loader_keeps_short_or_stale_m2_history_out_of_decision_inputs() -> None:
    short_rows = []
    for index in range(8):
        row = fact_row(
            None,
            "macro.m2_busd",
            effective_at=NOW - timedelta(weeks=7 - index),
            value=str(Decimal("20000") + index),
        )
        row.update(id=f"short-m2-{index}", provider_code="fred", signal_score=None)
        short_rows.append(row)
    short = load_asset_opinion_market_data(
        CountingConnection(fact_rows=short_rows),
        (("ADA", "crypto"),),
        ("BTC",),
        NOW,
    )
    short_fact = next(row for row in short.facts_for("ADA") if row.metric_code == "macro.m2_change_4w")
    assert short_fact.signed_score is None

    stale_rows = [dict(row) for row in short_rows]
    for stale_row in stale_rows:
        stale_row["observed_at"] = NOW - timedelta(days=8)
        stale_row["effective_at"] = stale_row["effective_at"] - timedelta(days=8)
    stale = load_asset_opinion_market_data(
        CountingConnection(fact_rows=stale_rows),
        (("ADA", "crypto"),),
        ("BTC",),
        NOW,
    )
    stale_fact = next(row for row in stale.facts_for("ADA") if row.metric_code == "macro.m2_change_4w")
    assert stale_fact.fresh is False
    assert stale_fact.signed_score is None
