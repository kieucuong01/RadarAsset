from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from collect_smart_insights import build_batch_collectors, run_live_smoke
from smart_insights.collectors.alternative_fng import AlternativeFearGreedCollector
from smart_insights.collectors.bitinfocharts import BitInfoChartsCollector
from smart_insights.collectors.coinmetrics import CoinMetricsCollector
from smart_insights.collectors.coinshares import CoinSharesCollector
from smart_insights.collectors.defillama import (
    DefiLlamaChainsCollector,
    DefiLlamaStablecoinsCollector,
)
from smart_insights.collectors.farside import FarsideEtfCollector
from smart_insights.collectors.deribit import DeribitCollector
from smart_insights.collectors.mempool import MempoolSpaceCollector
from smart_insights.contracts import RawSnapshot
from smart_insights.http import HttpResponse
from smart_insights.parsers.markdown_table import parse_markdown_table
from smart_insights.validation import validate_observations


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


class FakeCrawler:
    def __init__(self, markdown: str) -> None:
        self.markdown = markdown
        self.calls: list[str] = []

    def scrape(self, source: object, url: str) -> RawSnapshot:
        self.calls.append(url)
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
            metadata={"collector": "crawl4ai"},
        )


def test_batch_collectors_use_injected_local_crawler() -> None:
    crawler = FakeCrawler(fixture_text("farside-btc.md"))

    batch = build_batch_collectors(browser_client=crawler)["farside-btc-etf"](NOW)

    assert batch.error_code is None
    assert len(batch.observations) > 0
    assert crawler.calls == ["https://farside.co.uk/btc/"]


class RoutingTransport:
    def __init__(self, payloads: dict[str, str]) -> None:
        self.payloads = payloads
        self.calls: list[str] = []

    def fetch(
        self, url: str, *, timeout_seconds: float, max_bytes: int
    ) -> HttpResponse:
        assert timeout_seconds > 0
        assert max_bytes <= 10_000_000
        self.calls.append(url)
        match = next(key for key in self.payloads if key in url)
        return HttpResponse(
            status=200,
            headers={"Content-Type": "application/json"},
            body=self.payloads[match].encode("utf-8"),
            url=url,
        )


class SequencedTransport:
    def __init__(self, payloads: list[dict[str, object]]) -> None:
        self.payloads = payloads

    def fetch(
        self, url: str, *, timeout_seconds: float, max_bytes: int
    ) -> HttpResponse:
        payload = self.payloads.pop(0)
        return HttpResponse(
            status=200,
            headers={"Content-Type": "application/json"},
            body=json.dumps(payload).encode("utf-8"),
            url=url,
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
        "BTC", crawler=FakeCrawler(fixture_text("farside-btc.md"))
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
            crawler=FakeCrawler(fixture_text(f"farside-{asset.lower()}.md")),
        ).collect(NOW)
        assert batch.error_code is None
        assert next(
            row.value
            for row in batch.observations
            if row.dimensions.get("fund") == "TOTAL"
        ) == total

    broken_markdown = fixture_text("farside-btc.md").replace("**842.0**", "**800.0**")
    broken = FarsideEtfCollector(
        "BTC", crawler=FakeCrawler(broken_markdown)
    ).collect(NOW)
    rejected_date = datetime(2026, 8, 12, tzinfo=timezone.utc)
    assert broken.error_code == "RECONCILIATION_FAILED"
    assert rejected_date in broken.rejected_periods
    assert all(row.effective_at != rejected_date for row in broken.observations)


def test_coinmetrics_collects_only_closed_daily_metrics() -> None:
    transport = FakeTransport(fixture_text("coinmetrics.json"))
    batch = CoinMetricsCollector(transport=transport).collect(NOW)

    cutoff = NOW.replace(hour=0, minute=0, second=0, microsecond=0)
    assert {row.effective_at.hour for row in batch.observations} == {0}
    assert all(row.effective_at < cutoff for row in batch.observations)
    assert next(
        row.value
        for row in batch.observations
        if row.metric_code == "crypto.onchain.mvrv"
    ) == Decimal("2.11")
    assert all(row.asset_symbol == "BTC" for row in batch.observations)
    assert {
        row.dimensions["provider_metric"] for row in batch.observations
    } == {"AdrActCnt", "CapMVRVCur"}
    assert parse_qs(urlsplit(transport.calls[0][0]).query)["metrics"] == [
        "AdrActCnt,CapMVRVCur"
    ]


def test_coinmetrics_paging_cannot_move_backward() -> None:
    next_url = (
        "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
        "?next_page_token=owned-token"
    )
    transport = SequencedTransport(
        [
            {
                "data": [
                    {"asset": "btc", "time": "2026-08-12T00:00:00Z", "NVTAdj": "40"}
                ],
                "next_page_url": next_url,
            },
            {
                "data": [
                    {"asset": "btc", "time": "2026-08-11T00:00:00Z", "NVTAdj": "39"}
                ]
            },
        ]
    )

    batch = CoinMetricsCollector(transport=transport).collect(NOW)

    assert batch.error_code == "PAGINATION_ORDER"
    assert batch.observations == ()


def test_mempool_intraday_and_daily_history_keep_their_real_observation_times() -> None:
    payload = json.loads(fixture_text("mempool.json"))
    transport = RoutingTransport(
        {
            "/fees/recommended": json.dumps(payload["fees"]),
            "/api/mempool": json.dumps(payload["mempool"]),
            "/mining/hashrate/3y": json.dumps(payload["mining"]),
        }
    )
    batch = MempoolSpaceCollector(transport=transport).collect(NOW)

    instant = [
        row for row in batch.observations if row.dimensions.get("frequency") == "instant"
    ]
    daily = [
        row for row in batch.observations if row.dimensions.get("frequency") == "daily"
    ]
    assert instant
    assert {row.effective_at for row in instant} == {NOW}
    assert all(row.effective_at.hour == 0 and row.effective_at < NOW for row in daily)
    assert next(
        row.value
        for row in daily
        if row.metric_code == "crypto.network.hashrate_hs"
        and row.effective_at == datetime(2026, 8, 12, tzinfo=timezone.utc)
    ) == Decimal("9.2e20")


def test_defillama_normalizes_closed_stablecoin_series_and_observed_chain_tvl() -> None:
    stablecoins = DefiLlamaStablecoinsCollector(
        transport=FakeTransport(fixture_text("defillama-stablecoins.json"))
    ).collect(NOW)
    assert [row.value for row in stablecoins.observations] == [
        153_000_000_000,
        154_100_000_000,
    ]
    assert all(row.effective_at < NOW.replace(hour=0, minute=0, second=0, microsecond=0) for row in stablecoins.observations)

    chains = DefiLlamaChainsCollector(
        transport=FakeTransport(fixture_text("defillama-chains.json"))
    ).collect(NOW)
    assert next(
        row.value
        for row in chains.observations
        if row.dimensions.get("chain") == "TOTAL"
    ) == 150_000_000
    assert {row.effective_at for row in chains.observations} == {NOW}
    assert all(row.dimensions["frequency"] == "observed_daily" for row in chains.observations)
    assert validate_observations(chains.source, chains.observations) == chains.observations


def test_defillama_rejects_negative_and_duplicate_series() -> None:
    stable_payload = json.loads(fixture_text("defillama-stablecoins.json"))
    stable_payload[0]["totalCirculatingUSD"]["peggedUSD"] = -1
    negative = DefiLlamaStablecoinsCollector(
        transport=FakeTransport(json.dumps(stable_payload))
    ).collect(NOW)
    assert negative.error_code == "INVALID_VALUE"
    assert negative.observations == ()

    chain_payload = json.loads(fixture_text("defillama-chains.json"))
    chain_payload.append(dict(chain_payload[0]))
    duplicate = DefiLlamaChainsCollector(
        transport=FakeTransport(json.dumps(chain_payload))
    ).collect(NOW)
    assert duplicate.error_code == "DUPLICATE_SERIES"
    assert duplicate.observations == ()


def test_deribit_collects_closed_dvol_and_observation_time_perpetuals() -> None:
    payload = json.loads(fixture_text("deribit.json"))
    transport = RoutingTransport(
        {
            "currency=BTC": json.dumps(payload["btc_dvol"]),
            "currency=ETH": json.dumps(payload["eth_dvol"]),
            "instrument_name=BTC-PERPETUAL": json.dumps(payload["btc_ticker"]),
            "instrument_name=ETH-PERPETUAL": json.dumps(payload["eth_ticker"]),
        }
    )

    batch = DeribitCollector(transport=transport, clock=lambda: NOW).collect(NOW)

    btc_dvol = [
        row
        for row in batch.observations
        if row.metric_code == "crypto.derivatives.btc_dvol"
    ]
    assert [row.value for row in btc_dvol] == [Decimal("55.5"), Decimal("58.0")]
    assert all(row.effective_at.hour == 0 for row in btc_dvol)
    ticker_rows = [
        row for row in batch.observations if row.dimensions.get("frequency") == "instant"
    ]
    assert {row.dimensions["instrument"] for row in ticker_rows} == {
        "BTC-PERPETUAL",
        "ETH-PERPETUAL",
    }
    assert all(row.effective_at == NOW for row in ticker_rows)


def test_deribit_rejects_unknown_instrument() -> None:
    payload = json.loads(fixture_text("deribit.json"))
    payload["btc_ticker"]["result"]["instrument_name"] = "BTC-UNDECLARED"
    transport = RoutingTransport(
        {
            "currency=BTC": json.dumps(payload["btc_dvol"]),
            "currency=ETH": json.dumps(payload["eth_dvol"]),
            "instrument_name=BTC-PERPETUAL": json.dumps(payload["btc_ticker"]),
            "instrument_name=ETH-PERPETUAL": json.dumps(payload["eth_ticker"]),
        }
    )

    batch = DeribitCollector(transport=transport, clock=lambda: NOW).collect(NOW)

    assert batch.error_code == "UNKNOWN_INSTRUMENT"
    assert batch.observations == ()


def test_coinshares_keeps_weekly_period_separate_from_crawl_time() -> None:
    report_url = (
        "https://coinshares.com/insights/research-data/"
        "fund-flows-10-08-2026/"
    )
    batch = CoinSharesCollector(
        crawler=FakeCrawler(fixture_text("coinshares.md")),
        report_url=report_url,
    ).collect(NOW)

    assert batch.snapshot.observed_at == NOW
    assert {row.effective_at for row in batch.observations} == {
        datetime(2026, 8, 8, tzinfo=timezone.utc)
    }
    bitcoin = next(
        row
        for row in batch.observations
        if row.metric_code == "crypto.coinshares.net_flow_usd"
        and row.dimensions.get("asset") == "Bitcoin"
    )
    assert bitcoin.value == Decimal("793400000")
    assert bitcoin.dimensions["source_unit"] == "US$m"
    assert any(
        row.metric_code == "crypto.coinshares.aum_usd"
        and row.dimensions.get("region") == "United States"
        for row in batch.observations
    )


def test_coinshares_rejects_report_without_explicit_period() -> None:
    markdown = fixture_text("coinshares.md").replace(
        "Data available as at close 8 August 2026.", "Weekly data."
    )
    batch = CoinSharesCollector(
        crawler=FakeCrawler(markdown),
        report_url=(
            "https://coinshares.com/insights/research-data/"
            "fund-flows-10-08-2026/"
        ),
    ).collect(NOW)

    assert batch.error_code == "MISSING_PERIOD"
    assert batch.observations == ()


def test_bitinfocharts_excludes_reviewed_entities_and_reports_label_coverage() -> None:
    previous = {
        "bc1q0000000000000000000000000000000000001": Decimal("119000"),
        "3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6": Decimal("51000"),
        "1BoatSLRHtKNngkdXEeobR76b53LETtpyT": Decimal("10000"),
    }
    batch = BitInfoChartsCollector(
        crawler=FakeCrawler(fixture_text("bitinfocharts.md"))
    ).collect(NOW, previous_balances=previous)
    proxy = next(
        row
        for row in batch.observations
        if row.metric_code == "crypto.large_address.balance_change_btc"
    )

    assert proxy.value == Decimal("-10000")
    assert proxy.dimensions["cohort"] == "reviewed_non_exchange"
    assert Decimal(proxy.dimensions["label_coverage"]) < Decimal("1")
    assert proxy.dimensions["entrant_count"] == "0"
    assert proxy.dimensions["exit_count"] == "1"
    assert "whale" not in proxy.dimensions.values()
    assert next(
        row.value
        for row in batch.observations
        if row.metric_code == "crypto.large_address.excluded_balance_btc"
    ) == Decimal("348598")
    address_rows = [
        row
        for row in batch.observations
        if row.metric_code == "crypto.large_address.address_balance_btc"
    ]
    assert {row.dimensions["label_status"] for row in address_rows} == {
        "labelled",
        "unknown",
    }
    assert {row.value for row in address_rows} == {
        Decimal("120000"),
        Decimal("50000"),
    }


def test_bitinfocharts_first_snapshot_has_balance_but_no_change() -> None:
    batch = BitInfoChartsCollector(
        crawler=FakeCrawler(fixture_text("bitinfocharts.md"))
    ).collect(NOW)

    assert any(
        row.metric_code == "crypto.large_address.tracked_balance_btc"
        for row in batch.observations
    )
    assert all(
        row.metric_code != "crypto.large_address.balance_change_btc"
        for row in batch.observations
    )


def test_live_smoke_uses_production_parser_and_exposes_no_provider_body() -> None:
    collector = AlternativeFearGreedCollector(
        transport=FakeTransport(fixture_text("alternative-fng.json"))
    )

    outcome = run_live_smoke(
        "alternative-fng",
        as_of=NOW,
        batch_collectors={"alternative-fng": collector.collect},
    )

    assert outcome.status == "succeeded"
    assert outcome.records_fetched == 2
    assert outcome.effective_at == datetime(2026, 8, 12, tzinfo=timezone.utc)
    assert not hasattr(outcome, "payload")


def test_live_smoke_keeps_fixture_only_source_disabled_on_parser_error() -> None:
    outcome = run_live_smoke(
        "farside-btc-etf",
        as_of=NOW,
        batch_collectors={},
    )

    assert outcome.status == "failed"
    assert outcome.error_code == "SOURCE_NOT_IMPLEMENTED"
