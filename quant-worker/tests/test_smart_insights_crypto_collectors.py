from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import importlib
import json
from pathlib import Path
from types import SimpleNamespace
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


def fixture_json(name: str) -> object:
    return json.loads(fixture_text(name))


def coinshares_ocr_module():
    return importlib.import_module("smart_insights.coinshares_ocr")


def ocr_tokens(name: str) -> tuple[object, ...]:
    module = coinshares_ocr_module()
    return tuple(
        module.OcrToken(
            text=row["text"],
            confidence=Decimal(row["confidence"]),
            box=tuple(row["box"]),
        )
        for row in fixture_json(name)
    )


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
            metadata={"collector": "scrapling"},
        )


class FakeCrawlerHtml:
    def __init__(self, html: str) -> None:
        self.html = html
        self.calls: list[str] = []

    def scrape(self, source: object, url: str) -> RawSnapshot:
        self.calls.append(url)
        return RawSnapshot(
            content=json.dumps(
                {
                    "rawHtml": self.html,
                    "metadata": {"sourceURL": url},
                }
            ).encode("utf-8"),
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=NOW,
            metadata={"collector": "scrapling"},
        )


class FakeCoinSharesCrawler:
    def __init__(self, html: str) -> None:
        self.html = html
        self.downloads: list[str] = []

    def scrape(self, source: object, url: str) -> RawSnapshot:
        return RawSnapshot(
            content=json.dumps({"rawHtml": self.html}).encode("utf-8"),
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=NOW,
            metadata={"collector": "scrapling"},
        )

    def download(
        self, source: object, url: str, *, content_types: object
    ) -> SimpleNamespace:
        self.downloads.append(url)
        content = b"asset-image" if "ranked-flows-detail" in url else b"region-image"
        return SimpleNamespace(
            content=content,
            content_type="image/png",
            source_url=url,
            observed_at=NOW,
            metadata={"collector": "scrapling"},
        )


class FakeOcrEngine:
    version = "fake-ocr-v1"

    def __init__(
        self, asset_tokens: tuple[object, ...], region_tokens: tuple[object, ...]
    ) -> None:
        self.asset_tokens = asset_tokens
        self.region_tokens = region_tokens

    def recognize(self, image: bytes) -> tuple[object, ...]:
        return self.asset_tokens if image == b"asset-image" else self.region_tokens


def collect_coinshares(
    *,
    asset_tokens: tuple[object, ...] | None = None,
    region_tokens: tuple[object, ...] | None = None,
    html: str | None = None,
):
    report_url = (
        "https://coinshares.com/us/insights/research-data/fund-flows-01-06-26/"
    )
    return CoinSharesCollector(
        crawler=FakeCoinSharesCrawler(html or fixture_text("coinshares-article.html")),
        report_url=report_url,
        ocr_engine=FakeOcrEngine(
            asset_tokens or ocr_tokens("coinshares-asset-ocr.json"),
            region_tokens or ocr_tokens("coinshares-region-ocr.json"),
        ),
    ).collect(NOW)


def test_batch_collectors_use_injected_local_crawler() -> None:
    crawler = FakeCrawler(fixture_text("farside-btc.md"))

    batch = build_batch_collectors(scrapling_client=crawler)["farside-btc-etf"](NOW)

    assert batch.error_code is None
    assert len(batch.observations) > 0
    assert crawler.calls == ["https://farside.co.uk/btc/"]


def test_bitinfocharts_uses_the_injected_scrapling_client() -> None:
    scrapling = FakeCrawler(fixture_text("bitinfocharts.md"))

    batch = build_batch_collectors(scrapling_client=scrapling)[
        "bitinfocharts-top-addresses"
    ](NOW)

    assert batch.error_code is None
    assert scrapling.calls == [
        "https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html"
    ]


def test_farside_normalizes_live_multirow_html_and_ignores_open_date() -> None:
    crawler = FakeCrawlerHtml(fixture_text("farside-live.html"))

    batch = FarsideEtfCollector("BTC", crawler=crawler).collect(NOW)

    assert batch.error_code is None
    assert {row.dimensions["fund"] for row in batch.observations} == {
        "IBIT",
        "FBTC",
        "BITB",
        "ARKB",
        "TOTAL",
    }
    assert {row.effective_at for row in batch.observations} == {
        datetime(2026, 8, 11, tzinfo=timezone.utc),
        datetime(2026, 8, 12, tzinfo=timezone.utc),
    }
    assert next(
        row.value
        for row in batch.observations
        if row.effective_at == datetime(2026, 8, 12, tzinfo=timezone.utc)
        and row.dimensions["fund"] == "TOTAL"
    ) == Decimal("842000000")


def test_farside_html_rejects_schema_drift_duplicate_dates_and_bad_total() -> None:
    html = fixture_text("farside-live.html")
    missing_headers = html.replace("<th>IBIT</th>", "<th></th>")
    duplicate_date = html.replace("11 Aug 2026", "12 Aug 2026")
    bad_total = html.replace("<td>842.0</td>", "<td>800.0</td>")

    missing = FarsideEtfCollector(
        "BTC", crawler=FakeCrawlerHtml(missing_headers)
    ).collect(NOW)
    duplicate = FarsideEtfCollector(
        "BTC", crawler=FakeCrawlerHtml(duplicate_date)
    ).collect(NOW)
    unreconciled = FarsideEtfCollector(
        "BTC", crawler=FakeCrawlerHtml(bad_total)
    ).collect(NOW)

    assert missing.error_code == "SCHEMA_DRIFT"
    assert missing.observations == ()
    assert duplicate.error_code == "DUPLICATE_PERIOD"
    assert duplicate.observations == ()
    assert unreconciled.error_code == "RECONCILIATION_FAILED"
    assert unreconciled.rejected_periods == (
        datetime(2026, 8, 12, tzinfo=timezone.utc),
    )


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


def test_coinshares_discovers_only_ranked_asset_and_country_table_images() -> None:
    module = coinshares_ocr_module()

    images = module.discover_coinshares_images(
        fixture_text("coinshares-article.html"),
        "https://coinshares.com/us/insights/research-data/fund-flows-01-06-26/",
    )

    assert images == {
        "asset": (
            "https://a.storyblok.com/f/176807/1600x2000/2a1ca92d93/"
            "ranked-flows-detail-01062026.png/m/"
        ),
        "region": (
            "https://a.storyblok.com/f/176807/1600x2000/7665f2456d/"
            "flows-by-exchange-country-01062026.png/m/"
        ),
    }


def test_coinshares_reconstructs_tables_and_keeps_weekly_period() -> None:
    module = coinshares_ocr_module()
    asset = module.reconstruct_coinshares_table(
        ocr_tokens("coinshares-asset-ocr.json"), dimension="asset"
    )
    region = module.reconstruct_coinshares_table(
        ocr_tokens("coinshares-region-ocr.json"), dimension="region"
    )

    assert asset.global_flow_usd == Decimal("-1200000000")
    assert asset.global_aum_usd is None
    assert region.global_flow_usd == asset.global_flow_usd
    assert region.global_aum_usd == Decimal("115000000000")
    assert asset.effective_at == datetime(2026, 5, 29, tzinfo=timezone.utc)

    batch = collect_coinshares()

    assert batch.snapshot.observed_at == NOW
    assert {row.effective_at for row in batch.observations} == {
        datetime(2026, 5, 29, tzinfo=timezone.utc)
    }
    bitcoin = next(
        row
        for row in batch.observations
        if row.metric_code == "crypto.coinshares.net_flow_usd"
        and row.dimensions.get("asset") == "Bitcoin"
    )
    assert bitcoin.value == Decimal("-1000000000")
    assert bitcoin.dimensions["source_unit"] == "US$m"
    assert bitcoin.published_at == datetime(2026, 6, 1, tzinfo=timezone.utc)
    assert any(
        row.metric_code == "crypto.coinshares.aum_usd"
        and row.dimensions.get("region") == "United States"
        for row in batch.observations
    )
    payload = json.loads(batch.snapshot.content)
    assert {image["kind"] for image in payload["images"]} == {"asset", "region"}
    assert all(len(image["sha256"]) == 64 for image in payload["images"])


def test_coinshares_ocr_fails_closed_on_confidence_layout_unit_and_totals() -> None:
    module = coinshares_ocr_module()
    asset = list(ocr_tokens("coinshares-asset-ocr.json"))
    region = list(ocr_tokens("coinshares-region-ocr.json"))

    low_confidence = list(asset)
    low_confidence[5] = module.OcrToken(
        text=low_confidence[5].text,
        confidence=Decimal("0.89"),
        box=low_confidence[5].box,
    )
    missing_header = tuple(row for row in asset if row.text != "AUM")
    invalid_unit = list(asset)
    invalid_unit[0] = module.OcrToken(
        text="Ranked Flows detail",
        confidence=invalid_unit[0].confidence,
        box=invalid_unit[0].box,
    )
    bad_total = list(region)
    bad_total[11] = module.OcrToken(
        text="-1,100.0",
        confidence=bad_total[11].confidence,
        box=bad_total[11].box,
    )
    ambiguous_number = list(asset)
    ambiguous_number[5] = module.OcrToken(
        text="-1,O00.0",
        confidence=ambiguous_number[5].confidence,
        box=ambiguous_number[5].box,
    )
    duplicate_label = list(asset)
    duplicate_label[7] = module.OcrToken(
        text="Bitcoin",
        confidence=duplicate_label[7].confidence,
        box=duplicate_label[7].box,
    )

    cases = (
        (collect_coinshares(asset_tokens=tuple(low_confidence)), "OCR_LOW_CONFIDENCE"),
        (collect_coinshares(asset_tokens=missing_header), "OCR_LAYOUT_DRIFT"),
        (collect_coinshares(asset_tokens=tuple(invalid_unit)), "INVALID_UNIT"),
        (collect_coinshares(region_tokens=tuple(bad_total)), "RECONCILIATION_FAILED"),
        (collect_coinshares(asset_tokens=tuple(ambiguous_number)), "OCR_LAYOUT_DRIFT"),
        (collect_coinshares(asset_tokens=tuple(duplicate_label)), "DUPLICATE_SERIES"),
    )

    for batch, error_code in cases:
        assert batch.error_code == error_code
        assert batch.observations == ()


def test_coinshares_rejects_article_without_publication_date() -> None:
    html = fixture_text("coinshares-article.html").replace(
        "Published on Jun 1st, 2026", "Publication pending"
    )
    batch = collect_coinshares(html=html)

    assert batch.error_code == "MISSING_PUBLISHED_AT"
    assert batch.observations == ()


def test_coinshares_rejects_missing_region_image_and_future_publication() -> None:
    missing_region = fixture_text("coinshares-article.html").replace(
        '<img src="https://a.storyblok.com/f/176807/1600x2000/7665f2456d/flows-by-exchange-country-01062026.png/m/" alt="Flows by exchange country 01062026">',
        "",
    )
    future = fixture_text("coinshares-article.html").replace(
        "Published on Jun 1st, 2026", "Published on Sep 1st, 2026"
    )

    missing = collect_coinshares(html=missing_region)
    future_batch = collect_coinshares(html=future)

    assert missing.error_code == "MISSING_TABLE"
    assert missing.observations == ()
    assert future_batch.error_code == "INVALID_TIMESTAMP"
    assert future_batch.observations == ()


def test_rapidocr_adapter_normalizes_documented_boxes_texts_and_scores() -> None:
    module = coinshares_ocr_module()
    engine = module.RapidOcrEngine.__new__(module.RapidOcrEngine)
    engine._engine = lambda _image: SimpleNamespace(
        boxes=(((10.2, 20.1), (30.4, 19.8), (31.0, 40.2), (9.7, 40.0)),),
        txts=("Bitcoin",),
        scores=(0.98,),
    )

    tokens = engine.recognize(b"image")

    assert tokens == (
        module.OcrToken(
            text="Bitcoin",
            confidence=Decimal("0.98"),
            box=(10, 20, 31, 40),
        ),
    )


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
