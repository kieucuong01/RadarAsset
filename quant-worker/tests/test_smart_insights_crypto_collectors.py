from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path

from smart_insights.collectors.alternative_fng import AlternativeFearGreedCollector
from smart_insights.collectors.farside import FarsideEtfCollector
from smart_insights.contracts import RawSnapshot
from smart_insights.http import HttpResponse
from smart_insights.parsers.markdown_table import parse_markdown_table


NOW = datetime(2026, 8, 13, 9, 30, tzinfo=timezone.utc)
FIXTURES = Path(__file__).parent / "fixtures" / "smart_insights" / "crypto"


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


class FakeTransport:
    def __init__(self, payload: str) -> None:
        self.payload = payload
        self.calls: list[tuple[str, float, int]] = []

    def fetch(
        self, url: str, *, timeout_seconds: float, max_bytes: int
    ) -> HttpResponse:
        self.calls.append((url, timeout_seconds, max_bytes))
        return HttpResponse(
            status=200,
            headers={"Content-Type": "application/json"},
            body=self.payload.encode("utf-8"),
            url=url,
        )


class FakeFirecrawl:
    def __init__(self, markdown: str) -> None:
        self.markdown = markdown

    def scrape(self, source: object, url: str) -> RawSnapshot:
        payload = {
            "markdown": self.markdown,
            "rawHtml": "<table></table>",
            "metadata": {"sourceURL": url},
        }
        return RawSnapshot(
            content=json.dumps(payload).encode("utf-8"),
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=NOW,
            metadata={"collector": "firecrawl"},
        )


def test_markdown_table_parser_is_bounded_and_preserves_cells() -> None:
    table = parse_markdown_table(
        fixture_text("farside-btc.md"), required_headers=("Date", "Total")
    )

    assert table.headers == ("Date", "IBIT", "FBTC", "BITB", "ARKB", "Total")
    assert table.rows[0]["Total"] == "842.0"
    assert table.rows[0]["BITB"] == "(8.0)"
    assert table.raw_rows[0][-1] == "**842.0**"


def test_markdown_table_parser_rejects_missing_or_duplicate_schema() -> None:
    missing = "| Date | Value |\n| --- | --- |\n| 12 Aug 2026 | 1 |"
    duplicate = "| Date | Total | Total |\n| --- | --- | --- |\n| x | 1 | 1 |"

    for markdown in (missing, duplicate):
        try:
            parse_markdown_table(markdown, required_headers=("Date", "Total"))
        except ValueError as error:
            assert str(error) == "SCHEMA_DRIFT"
        else:
            raise AssertionError("Expected schema drift.")


def test_alternative_fng_collects_closed_daily_history_with_attribution() -> None:
    transport = FakeTransport(fixture_text("alternative-fng.json"))
    batch = AlternativeFearGreedCollector(transport=transport).collect(NOW)

    assert [row.value for row in batch.observations] == [24, 27]
    assert [row.effective_at for row in batch.observations] == [
        datetime(2026, 8, 12, tzinfo=timezone.utc),
        datetime(2026, 8, 11, tzinfo=timezone.utc),
    ]
    assert all(row.metric_code == "crypto.fear_greed.index" for row in batch.observations)
    assert batch.snapshot.metadata["attribution"] == "Alternative.me"
    assert batch.snapshot.metadata["terms_url"].startswith("https://")
    assert transport.calls[0][2] <= 5_000_000


def test_alternative_fng_rejects_invalid_and_duplicate_provider_dates() -> None:
    payload = json.loads(fixture_text("alternative-fng.json"))
    payload["data"][0]["value"] = "101"
    invalid = AlternativeFearGreedCollector(
        transport=FakeTransport(json.dumps(payload))
    ).collect(NOW)
    assert invalid.error_code == "INVALID_VALUE"
    assert invalid.observations == ()

    payload = json.loads(fixture_text("alternative-fng.json"))
    payload["data"][1]["timestamp"] = payload["data"][0]["timestamp"]
    duplicate = AlternativeFearGreedCollector(
        transport=FakeTransport(json.dumps(payload))
    ).collect(NOW)
    assert duplicate.error_code == "DUPLICATE_PERIOD"
    assert duplicate.observations == ()


def test_farside_btc_reconciles_funds_to_reported_total() -> None:
    batch = FarsideEtfCollector(
        "BTC", firecrawl=FakeFirecrawl(fixture_text("farside-btc.md"))
    ).collect(NOW)
    totals = [
        row
        for row in batch.observations
        if row.metric_code == "crypto.etf.net_flow_usd"
        and row.dimensions == {"asset": "BTC", "fund": "TOTAL"}
    ]

    assert totals[0].effective_at == datetime(2026, 8, 12, tzinfo=timezone.utc)
    assert totals[0].value == 842_000_000
    same_day_funds = [
        row
        for row in batch.observations
        if row.effective_at == totals[0].effective_at
        and row.dimensions.get("fund") != "TOTAL"
    ]
    assert sum(row.value for row in same_day_funds) == totals[0].value


def test_farside_supports_btc_eth_sol_and_quarantines_bad_total() -> None:
    expected = {"BTC": 842_000_000, "ETH": 125_500_000, "SOL": 44_200_000}
    for asset, total in expected.items():
        batch = FarsideEtfCollector(
            asset,
            firecrawl=FakeFirecrawl(fixture_text(f"farside-{asset.lower()}.md")),
        ).collect(NOW)
        assert batch.error_code is None
        assert next(
            row.value
            for row in batch.observations
            if row.dimensions.get("fund") == "TOTAL"
        ) == total

    broken_markdown = fixture_text("farside-btc.md").replace("**842.0**", "**800.0**")
    broken = FarsideEtfCollector(
        "BTC", firecrawl=FakeFirecrawl(broken_markdown)
    ).collect(NOW)
    rejected_date = datetime(2026, 8, 12, tzinfo=timezone.utc)
    assert broken.error_code == "RECONCILIATION_FAILED"
    assert rejected_date in broken.rejected_periods
    assert all(row.effective_at != rejected_date for row in broken.observations)
