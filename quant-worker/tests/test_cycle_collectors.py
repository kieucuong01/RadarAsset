from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

import smart_insights.collectors.blockchaincenter as blockchaincenter
import smart_insights.collectors.cbbi as cbbi
from smart_insights.contracts import RawSnapshot
from smart_insights.http import SourceFetchError
from smart_insights.scrapling_client import DownloadedAsset, ScraplingClient
from smart_insights.sources import source_for_code


def test_cycle_collector_modules_exist() -> None:
    assert blockchaincenter is not None
    assert cbbi is not None


NOW = datetime(2026, 8, 14, 23, tzinfo=timezone.utc)
FIXTURES = Path(__file__).parent / "fixtures" / "smart_insights" / "crypto"
CBBI_URL = "https://colintalkscrypto.com/cbbi/data/latest.json"


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def response(
    *,
    body: bytes,
    url: str = CBBI_URL,
    content_type: str = "application/json",
) -> SimpleNamespace:
    return SimpleNamespace(
        body=body,
        url=url,
        status=200,
        headers={"content-type": content_type},
    )


def test_scrapling_download_json_is_allowlisted_and_bounded() -> None:
    client = ScraplingClient(
        fetcher=lambda _url: response(
            body=b'{"Confidence":{"1723593600":0.615}}'
        ),
        clock=lambda: NOW,
        max_json_bytes=1_024,
    )

    asset = client.download_json(source_for_code("cbbi-public"), CBBI_URL)

    assert asset.content_type == "application/json"
    assert asset.source_url == CBBI_URL
    assert asset.observed_at == NOW
    assert asset.metadata["parser_version"] == "cbbi-v1"


@pytest.mark.parametrize(
    ("asset_response", "max_bytes", "code"),
    (
        (response(body=b"{}", content_type="text/plain"), 100, "INVALID_RESPONSE"),
        (
            response(body=b"{}", url="https://evil.invalid/latest.json"),
            100,
            "REDIRECT_REJECTED",
        ),
        (response(body=b"\xff"), 100, "INVALID_RESPONSE"),
        (response(body=b"not-json"), 100, "INVALID_RESPONSE"),
        (response(body=b'{"too":"large"}'), 5, "RESPONSE_TOO_LARGE"),
    ),
)
def test_scrapling_download_json_rejects_untrusted_responses(
    asset_response: SimpleNamespace, max_bytes: int, code: str
) -> None:
    client = ScraplingClient(
        fetcher=lambda _url: asset_response,
        max_json_bytes=max_bytes,
    )
    with pytest.raises(SourceFetchError) as error:
        client.download_json(source_for_code("cbbi-public"), CBBI_URL)
    assert error.value.code == code


def test_scrapling_download_json_rejects_outside_url_before_fetch() -> None:
    calls: list[str] = []
    client = ScraplingClient(fetcher=lambda url: calls.append(url))
    with pytest.raises(ValueError, match="allow-listed"):
        client.download_json(
            source_for_code("cbbi-public"), "https://evil.invalid/latest.json"
        )
    assert calls == []


def test_altseason_parser_keeps_three_horizons_and_boundaries() -> None:
    observations = blockchaincenter.parse_altcoin_season(
        fixture_text("blockchaincenter-altseason.html"), NOW
    )

    assert [(row.dimensions["horizon"], row.value) for row in observations] == [
        ("season_90d", Decimal("61")),
        ("month", Decimal("43")),
        ("year", Decimal("37")),
    ]
    assert blockchaincenter.classify_altcoin_season(25) == "bitcoin_season"
    assert blockchaincenter.classify_altcoin_season(26) == "neutral"
    assert blockchaincenter.classify_altcoin_season(74) == "neutral"
    assert blockchaincenter.classify_altcoin_season(75) == "altcoin_season"


@pytest.mark.parametrize(
    "html",
    (
        fixture_text("blockchaincenter-altseason.html").replace(
            "Altcoin Year Index", "Year Index", 1
        ),
        fixture_text("blockchaincenter-altseason.html").replace(
            '<div class="value">61</div>', '<div class="value">101</div>', 1
        ),
        fixture_text("blockchaincenter-altseason.html").replace("75%", "74%", 1),
        fixture_text("blockchaincenter-altseason.html").replace(
            "Altcoin Month Index", "Altcoin Season Index", 1
        ),
    ),
)
def test_altseason_parser_rejects_missing_duplicate_or_contradictory_data(
    html: str,
) -> None:
    with pytest.raises(ValueError, match="SCHEMA_DRIFT|INVALID_VALUE"):
        blockchaincenter.parse_altcoin_season(html, NOW)


def test_cbbi_parser_publishes_confidence_and_nine_components() -> None:
    observations = cbbi.parse_cbbi_json(fixture_bytes("cbbi-latest.json"), as_of=NOW)
    latest_at = datetime(2026, 8, 14, tzinfo=timezone.utc)
    latest = [row for row in observations if row.effective_at == latest_at]

    assert len(latest) == 10
    assert {row.metric_code for row in latest} == {
        "crypto.cycle.cbbi.confidence",
        *{
            f"crypto.cycle.cbbi.component.{slug}"
            for slug in cbbi.CBBI_COMPONENTS.values()
        },
    }
    assert all(Decimal("0") <= row.value <= Decimal("100") for row in latest)
    assert next(
        row for row in latest if row.metric_code.endswith("confidence")
    ).value == Decimal("31.3400")
    assert all(row.dimensions["provider_scale"] == "0_to_1" for row in latest)
    assert all("price" not in row.metric_code for row in observations)
    assert len(observations) == 19


def test_cbbi_parser_sorts_unsorted_provider_timestamps() -> None:
    payload = json.loads(fixture_bytes("cbbi-latest.json"))
    payload["Confidence"] = {
        "1786665600": 0.3134,
        "1786579200": 0.3000,
    }

    observations = cbbi.parse_cbbi_json(
        json.dumps(payload).encode("utf-8"), as_of=NOW
    )
    confidence = [
        row for row in observations if row.metric_code.endswith("confidence")
    ]
    assert [row.effective_at for row in confidence] == sorted(
        row.effective_at for row in confidence
    )


@pytest.mark.parametrize(
    ("mutate", "code"),
    (
        (lambda payload: payload.pop("MVRV"), "SCHEMA_DRIFT"),
        (
            lambda payload: payload["Confidence"].__setitem__("1786665600", 1.1),
            "INVALID_VALUE",
        ),
        (
            lambda payload: payload["Confidence"].__setitem__("bad-epoch", 0.3),
            "INVALID_TIMESTAMP",
        ),
        (
            lambda payload: payload["Confidence"].__setitem__("1786752000", 0.3),
            "INVALID_TIMESTAMP",
        ),
    ),
)
def test_cbbi_parser_rejects_incomplete_invalid_or_future_series(
    mutate: object, code: str
) -> None:
    payload = json.loads(fixture_bytes("cbbi-latest.json"))
    assert callable(mutate)
    mutate(payload)
    with pytest.raises(ValueError, match=code):
        cbbi.parse_cbbi_json(json.dumps(payload).encode("utf-8"), as_of=NOW)


def test_cbbi_discovery_requires_the_exact_public_json_link() -> None:
    page_url = "https://colintalkscrypto.com/cbbi/"
    assert cbbi.discover_cbbi_json_url(
        fixture_text("cbbi-page.html"), page_url
    ) == CBBI_URL
    with pytest.raises(ValueError, match="SCHEMA_DRIFT"):
        cbbi.discover_cbbi_json_url(
            fixture_text("cbbi-page.html").replace(
                "/cbbi/data/latest.json", "https://evil.invalid/latest.json", 1
            ),
            page_url,
        )


class FakeCrawler:
    def scrape(self, _source: object, url: str) -> RawSnapshot:
        html = (
            fixture_text("cbbi-page.html")
            if url.endswith("/cbbi/")
            else fixture_text("blockchaincenter-altseason.html")
        )
        return RawSnapshot(
            content=json.dumps({"rawHtml": html}).encode("utf-8"),
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=NOW,
            metadata={"collector": "scrapling"},
        )

    def download_json(self, _source: object, url: str) -> DownloadedAsset:
        return DownloadedAsset(
            content=fixture_bytes("cbbi-latest.json"),
            content_type="application/json",
            source_url=url,
            observed_at=NOW,
            metadata={"collector": "scrapling"},
        )


def test_cycle_collectors_build_batches_with_composite_cbbi_evidence() -> None:
    altseason = blockchaincenter.BlockchainCenterAltcoinSeasonCollector(
        crawler=FakeCrawler()
    ).collect(NOW)
    assert altseason.error_code is None
    assert len(altseason.observations) == 3

    cbbi_batch = cbbi.CbbiCollector(crawler=FakeCrawler()).collect(NOW)
    assert cbbi_batch.error_code is None
    assert len(cbbi_batch.observations) == 19
    assert cbbi_batch.snapshot.metadata["parser_version"] == "cbbi-v1"
    evidence = json.loads(cbbi_batch.snapshot.content)
    assert evidence["page"]["url"] == "https://colintalkscrypto.com/cbbi/"
    assert evidence["data"]["url"] == CBBI_URL
