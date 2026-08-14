from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path

import pytest

import smart_insights.collectors.coinglass as coinglass
from smart_insights.contracts import RawSnapshot


def test_coinglass_collector_module_exists() -> None:
    assert coinglass is not None


NOW = datetime(2026, 8, 14, 22, 5, tzinfo=timezone.utc)
FIXTURES = Path(__file__).parent / "fixtures" / "smart_insights" / "crypto"


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_margin_parser_preserves_reported_rates_and_utc_hours() -> None:
    rows = coinglass.parse_margin_table(fixture_text("coinglass-margin.html"), NOW)

    assert rows[0].effective_at == datetime(2026, 8, 14, 22, tzinfo=timezone.utc)
    assert [(row.metric_code, row.value) for row in rows[:3]] == [
        ("crypto.derivatives.margin_borrow.annualized_rate", Decimal("4.05")),
        ("crypto.derivatives.margin_borrow.daily_rate", Decimal("0.0113")),
        ("crypto.derivatives.margin_borrow.hourly_rate", Decimal("0.000469")),
    ]
    assert len(rows) == 6
    assert all(row.asset_symbol is None for row in rows)
    assert all(row.dimensions["exchange"] == "Binance" for row in rows)
    assert all(row.dimensions["quote_asset"] == "USDT" for row in rows)


def test_margin_parser_accepts_ant_design_split_header_and_body_tables() -> None:
    split = fixture_text("coinglass-margin.html").replace(
        "</thead>\n  <tbody>", "</thead></table><table><tbody>", 1
    )

    rows = coinglass.parse_margin_table(split, NOW)

    assert len(rows) == 6
    assert coinglass._table_ready(split, coinglass._MARGIN_HEADERS)
    empty = split[: split.index("<tbody>") + len("<tbody>")] + (
        "<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>"
        "</tbody></table></body></html>"
    )
    assert not coinglass._table_ready(empty, coinglass._MARGIN_HEADERS)


@pytest.mark.parametrize(
    ("html", "code"),
    (
        (
            fixture_text("coinglass-margin.html").replace("4.05%", "4.05", 1),
            "INVALID_VALUE",
        ),
        (
            fixture_text("coinglass-margin.html").replace(
                "2026-08-14 21:00", "2026-08-14 22:00", 1
            ),
            "DUPLICATE_PERIOD",
        ),
        (
            fixture_text("coinglass-margin.html").replace(
                "2026-08-14 22:00", "2026-08-15 00:00", 1
            ),
            "INVALID_TIMESTAMP",
        ),
        (
            fixture_text("coinglass-margin.html").replace(
                "Annualized Interest Rate", "Annual Rate", 1
            ),
            "SCHEMA_DRIFT",
        ),
    ),
)
def test_margin_parser_rejects_ambiguous_or_invalid_rows(
    html: str, code: str
) -> None:
    with pytest.raises(ValueError, match=code):
        coinglass.parse_margin_table(html, NOW)


def test_maxpain_parser_keeps_sides_and_filters_symbols() -> None:
    rows = coinglass.parse_maxpain_table(
        fixture_text("coinglass-maxpain.html"),
        NOW,
        symbols=frozenset({"BTC", "ETH", "SOL"}),
    )

    assert len(rows) == 21
    assert {row.asset_symbol for row in rows} == {"BTC", "ETH", "SOL"}
    assert all(row.dimensions["range"] == "24h" for row in rows)
    btc = [row for row in rows if row.asset_symbol == "BTC"]
    assert {row.metric_code: row.value for row in btc} == {
        "crypto.derivatives.liquidation.current_price_usd": Decimal("62609.4"),
        "crypto.derivatives.liquidation.short_max_pain_price_usd": Decimal("65000"),
        "crypto.derivatives.liquidation.short_distance_ratio": Decimal("0.0382"),
        "crypto.derivatives.liquidation.short_max_pain_level_usd": Decimal("120000000"),
        "crypto.derivatives.liquidation.long_max_pain_price_usd": Decimal("60000"),
        "crypto.derivatives.liquidation.long_distance_ratio": Decimal("-0.0417"),
        "crypto.derivatives.liquidation.long_max_pain_level_usd": Decimal("98500000"),
    }


def test_maxpain_parser_accepts_live_grouped_side_cells() -> None:
    rows = coinglass.parse_maxpain_table(
        fixture_text("coinglass-maxpain-live.html"),
        NOW,
        symbols=frozenset({"BTC", "ETH", "SOL"}),
    )

    assert len(rows) == 14
    btc = {row.metric_code: row.value for row in rows if row.asset_symbol == "BTC"}
    assert btc == {
        "crypto.derivatives.liquidation.current_price_usd": Decimal("63034.3"),
        "crypto.derivatives.liquidation.short_max_pain_price_usd": Decimal(
            "63386.16"
        ),
        "crypto.derivatives.liquidation.short_distance_ratio": Decimal("0.0056"),
        "crypto.derivatives.liquidation.short_max_pain_level_usd": Decimal(
            "45300000"
        ),
        "crypto.derivatives.liquidation.long_max_pain_price_usd": Decimal(
            "62129.04"
        ),
        "crypto.derivatives.liquidation.long_distance_ratio": Decimal("-0.0144"),
        "crypto.derivatives.liquidation.long_max_pain_level_usd": Decimal(
            "47080000"
        ),
    }


@pytest.mark.parametrize(
    ("html", "symbols", "code"),
    (
        (
            fixture_text("coinglass-maxpain.html").replace(
                "<td>ETH</td>", "<td>BTC</td>", 1
            ),
            frozenset({"BTC", "ETH", "SOL"}),
            "DUPLICATE_ASSET",
        ),
        (
            fixture_text("coinglass-maxpain.html").replace("$62,609.4", "$-1", 1),
            frozenset({"BTC", "ETH", "SOL"}),
            "INVALID_VALUE",
        ),
        (
            fixture_text("coinglass-maxpain.html").replace("3.82%", "9.00%", 1),
            frozenset({"BTC", "ETH", "SOL"}),
            "INVALID_DISTANCE",
        ),
        (
            fixture_text("coinglass-maxpain.html").replace(
                "Short Distance", "Short Gap", 1
            ),
            frozenset({"BTC", "ETH", "SOL"}),
            "SCHEMA_DRIFT",
        ),
        (
            fixture_text("coinglass-maxpain.html"),
            frozenset({"DOGE"}),
            "SCHEMA_DRIFT",
        ),
    ),
)
def test_maxpain_parser_rejects_schema_drift_and_inconsistent_values(
    html: str, symbols: frozenset[str], code: str
) -> None:
    with pytest.raises(ValueError, match=code):
        coinglass.parse_maxpain_table(html, NOW, symbols=symbols)


class FakeCrawler:
    def __init__(self, html: str) -> None:
        self.html = html

    def scrape(self, source: object, url: str, *, ready: object) -> RawSnapshot:
        assert callable(ready) and ready(self.html)
        return RawSnapshot(
            content=json.dumps(
                {"rawHtml": self.html, "metadata": {"sourceURL": url}}
            ).encode("utf-8"),
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=NOW,
            metadata={"collector": "nodriver"},
        )


def test_coinglass_collectors_return_batches_or_stable_parser_errors() -> None:
    margin = coinglass.CoinGlassMarginCollector(
        crawler=FakeCrawler(fixture_text("coinglass-margin.html"))
    ).collect(NOW)
    assert margin.error_code is None
    assert len(margin.observations) == 6

    invalid = coinglass.CoinGlassMarginCollector(
        crawler=FakeCrawler(
            fixture_text("coinglass-margin.html").replace("4.05%", "4.05", 1)
        )
    ).collect(NOW)
    assert invalid.observations == ()
    assert invalid.error_code == "INVALID_VALUE"
