from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from email.message import Message
import hashlib
import importlib
import json
import os
from pathlib import Path
import socket
import sys
from types import ModuleType, SimpleNamespace
from urllib.error import HTTPError, URLError

import pytest

import collect_smart_insights
from collect_smart_insights import SCHEDULES, run_collection, select_sources
from smart_insights.contracts import (
    CollectionMode,
    LicenseScope,
    Market,
    ObservationInput,
    RawSnapshot,
    SourceDefinition,
    SourceRunResult,
)
from smart_insights.artifacts import ArtifactIntegrityError, ArtifactStore
from smart_insights.http import SourceFetchError, UrllibTransport
from smart_insights.sources import (
    ENABLED_SOURCE_CODES,
    SOURCE_CODES,
    is_source_url_allowed,
    source_for_code,
    sources_for_schedule,
)
from smart_insights.validation import ObservationValidationError, validate_observations


NOW = datetime(2026, 8, 13, tzinfo=timezone.utc)


def test_active_schedules_have_no_retired_wgc_source_period_job() -> None:
    assert "monthly" not in SCHEDULES


def test_four_hourly_is_a_cli_and_wrapper_schedule() -> None:
    assert "four-hourly" in SCHEDULES
    assert collect_smart_insights._SOURCE_SCHEDULE["four-hourly"] == "four-hourly"
    wrapper = Path("../scripts/run-smart-insights.ps1").read_text(encoding="utf-8")
    assert '"four-hourly"' in wrapper
    assert '"--cbbi-backfill"' in wrapper


def test_database_connection_accepts_prisma_public_schema_url() -> None:
    calls: list[tuple[str, dict[str, object]]] = []
    sentinel = object()

    def connect(url: str, **kwargs: object) -> object:
        calls.append((url, kwargs))
        return sentinel

    connection = collect_smart_insights.connect_database(
        "postgresql://user:pass@localhost:5432/qa?schema=public&sslmode=disable",
        connection_factory=connect,
    )

    assert connection is sentinel
    assert calls[0][0] == "postgresql://user:pass@localhost:5432/qa?sslmode=disable"


class FakeResponse:
    def __init__(
        self,
        body: bytes,
        *,
        url: str = "https://example.test/source",
        status: int = 200,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._body = body
        self._offset = 0
        self._url = url
        self.status = status
        self.headers = headers or {}

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def geturl(self) -> str:
        return self._url

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = len(self._body) - self._offset
        chunk = self._body[self._offset : self._offset + size]
        self._offset += len(chunk)
        return chunk


class FakeOpener:
    def __init__(self, *outcomes: FakeResponse | Exception) -> None:
        self.outcomes = list(outcomes)
        self.attempts = 0

    def open(self, _request: object, *, timeout: float) -> FakeResponse:
        assert timeout > 0
        self.attempts += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeJsonTransport:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def post_json(self, *_args: object, **_kwargs: object) -> dict[str, object]:
        return self.payload


def http_error(url: str, status: int, headers: dict[str, str] | None = None) -> HTTPError:
    message = Message()
    for name, value in (headers or {}).items():
        message[name] = value
    return HTTPError(url, status, "upstream detail must stay private", message, None)


def snapshot(content: bytes = b"payload") -> RawSnapshot:
    return RawSnapshot(
        content=content,
        content_type="application/json",
        source_url="https://farside.co.uk/btc/",
        effective_at=None,
        published_at=None,
        observed_at=NOW,
    )


def test_registry_rejects_unknown_and_non_https_sources() -> None:
    assert source_for_code("alternative-fng").collection_mode is CollectionMode.API
    with pytest.raises(KeyError):
        source_for_code("user-supplied")
    with pytest.raises(ValueError, match="HTTPS"):
        SourceDefinition(
            code="bad",
            name="Bad",
            market=Market.CRYPTO,
            collection_mode=CollectionMode.API,
            license_scope=LicenseScope.RESEARCH_ONLY,
            urls=("http://example.test",),
            schedule="daily",
            freshness_sla_minutes=1_440,
            parser_version="1",
            quality_tier=Decimal("1"),
        )


def test_registry_is_code_owned_live_smoked_and_quality_weighted() -> None:
    assert SOURCE_CODES == (
        "alternative-fng",
        "bitinfocharts-top-addresses",
        "blockchaincenter-altcoin-season",
        "cbbi-public",
        "cftc-disaggregated",
        "cftc-legacy",
        "coinglass-liquidation-maxpain",
        "coinglass-margin-borrow",
        "coinmetrics-community",
        "coinshares-weekly",
        "cryptocraft",
        "defillama-chains",
        "defillama-stablecoins",
        "deribit-public",
        "farside-btc-etf",
        "farside-eth-etf",
        "farside-sol-etf",
        "fred",
        "mempool-btc-large-addresses",
        "mempool-space",
    )
    assert ENABLED_SOURCE_CODES == {
        "alternative-fng",
        "bitinfocharts-top-addresses",
        "coinmetrics-community",
        "cryptocraft",
        "defillama-chains",
        "defillama-stablecoins",
        "deribit-public",
        "farside-btc-etf",
        "farside-eth-etf",
        "farside-sol-etf",
        "mempool-space",
    }
    assert {
        code for code in SOURCE_CODES if source_for_code(code).enabled
    } == ENABLED_SOURCE_CODES
    assert source_for_code("fred").license_scope is LicenseScope.PUBLIC_OFFICIAL
    assert source_for_code("fred").quality_tier == Decimal("1.00")
    assert source_for_code("farside-btc-etf").quality_tier == Decimal("0.70")
    assert (
        source_for_code("bitinfocharts-top-addresses").collection_mode
        is CollectionMode.SCRAPLING
    )
    assert source_for_code("cryptocraft").collection_mode is CollectionMode.SCRAPLING
    assert source_for_code("bitinfocharts-top-addresses").quality_tier == Decimal(
        "0.50"
    )
    large_addresses = source_for_code("mempool-btc-large-addresses")
    assert large_addresses.collection_mode is CollectionMode.API
    assert large_addresses.schedule == "daily"
    assert large_addresses.enabled is False
    assert tuple(source.code for source in sources_for_schedule("daily")) == (
        "alternative-fng",
        "bitinfocharts-top-addresses",
        "coinmetrics-community",
        "defillama-chains",
        "defillama-stablecoins",
        "deribit-public",
        "farside-btc-etf",
        "farside-eth-etf",
        "farside-sol-etf",
        "mempool-space",
    )


def test_cycle_and_coinglass_sources_are_registered_fail_closed() -> None:
    expected = {
        "coinglass-margin-borrow": ("four-hourly", 480),
        "coinglass-liquidation-maxpain": ("four-hourly", 480),
        "blockchaincenter-altcoin-season": ("daily", 2_880),
        "cbbi-public": ("daily", 2_880),
    }
    for code, (schedule, sla) in expected.items():
        source = source_for_code(code)
        assert source.collection_mode is CollectionMode.SCRAPLING
        assert source.license_scope is LicenseScope.RESEARCH_ONLY
        assert source.schedule == schedule
        assert source.freshness_sla_minutes == sla
        assert source.enabled is False

    assert source_for_code("coinglass-margin-borrow").urls == (
        "https://www.coinglass.com/pro/i/MarginFeeChart",
    )
    assert source_for_code("coinglass-liquidation-maxpain").urls == (
        "https://www.coinglass.com/liquidation-maxpain",
    )
    assert source_for_code("blockchaincenter-altcoin-season").urls == (
        "https://www.blockchaincenter.net/altcoin-season-index/",
    )
    assert source_for_code("cbbi-public").urls == (
        "https://colintalkscrypto.com/cbbi/",
        "https://colintalkscrypto.com/cbbi/data/latest.json",
    )

    cbbi = source_for_code("cbbi-public")
    assert is_source_url_allowed(cbbi, "https://colintalkscrypto.com/cbbi/")
    assert is_source_url_allowed(
        cbbi, "https://colintalkscrypto.com/cbbi/data/latest.json"
    )
    assert not is_source_url_allowed(
        cbbi, "https://colintalkscrypto.com/cbbi/data/latest.json?cache=off"
    )
    assert not is_source_url_allowed(cbbi, "https://evil.invalid/cbbi/data/latest.json")


def test_discovered_links_remain_inside_source_specific_paths() -> None:
    cryptocraft = source_for_code("cryptocraft")
    assert is_source_url_allowed(
        cryptocraft, "https://www.cryptocraft.com/calendar/123-us-cpi"
    )
    assert not is_source_url_allowed(
        cryptocraft, "https://www.cryptocraft.com/news/123-us-cpi"
    )
    assert not is_source_url_allowed(
        cryptocraft, "https://evil.invalid/calendar/123-us-cpi"
    )

    coinshares = source_for_code("coinshares-weekly")
    assert is_source_url_allowed(
        coinshares,
        "https://coinshares.com/insights/research-data/fund-flows-weekly-2026-08-10/",
    )
    assert not is_source_url_allowed(
        coinshares, "https://coinshares.com/company/investor-relations/"
    )
    assert is_source_url_allowed(
        coinshares,
        "https://a.storyblok.com/f/176807/1600x2000/hash/ranked-flows-detail.png/m/",
    )
    assert is_source_url_allowed(
        coinshares, "https://coinshares.com/insights/research-data/?page=3"
    )
    assert not is_source_url_allowed(
        coinshares, "https://coinshares.com/insights/research-data/?page=6"
    )
    assert not is_source_url_allowed(
        coinshares,
        "https://a.storyblok.com/f/999999/1600x2000/hash/ranked-flows-detail.png/m/",
    )

def test_coinshares_discovery_accepts_current_two_digit_year_slugs() -> None:
    class Crawler:
        @staticmethod
        def scrape(_source: object, url: str) -> RawSnapshot:
            content = json.dumps(
                {
                    "markdown": (
                        "[older](https://coinshares.com/insights/research-data/"
                        "fund-flows-25-05-26/)\n"
                        "[latest](https://coinshares.com/insights/research-data/"
                        "fund-flows-01-06-26/)"
                    )
                }
            ).encode()
            return replace(snapshot(content), source_url=url)

    assert collect_smart_insights._discover_coinshares_report(Crawler()) == (
        "https://coinshares.com/insights/research-data/fund-flows-01-06-26/"
    )


def test_coinshares_discovery_reads_scrapling_raw_html() -> None:
    class Crawler:
        @staticmethod
        def scrape(_source: object, url: str) -> RawSnapshot:
            content = json.dumps(
                {
                    "rawHtml": (
                        '<a href="/insights/research-data/fund-flows-25-05-26/">older</a>'
                        '<a href="/us/insights/research-data/fund-flows-01-06-26/">latest</a>'
                    )
                }
            ).encode()
            return replace(snapshot(content), source_url=url)

    assert collect_smart_insights._discover_coinshares_report(Crawler()) == (
        "https://coinshares.com/us/insights/research-data/fund-flows-01-06-26/"
    )


def test_coinshares_discovery_scans_bounded_pages_when_link_is_generic() -> None:
    class Crawler:
        urls: list[str] = []

        @staticmethod
        def scrape(_source: object, url: str) -> RawSnapshot:
            Crawler.urls.append(url)
            html = '<a href="insights/research-data/fund-flows">Read more</a>'
            if url.endswith("?page=2"):
                html = (
                    '<a href="/insights/research-data/'
                    'fund-flows-01-06-26/">latest</a>'
                )
            content = json.dumps({"rawHtml": html}).encode()
            return replace(snapshot(content), source_url=url)

    assert collect_smart_insights._discover_coinshares_report(Crawler()) == (
        "https://coinshares.com/insights/research-data/fund-flows-01-06-26/"
    )
    assert Crawler.urls == [
        "https://coinshares.com/insights/research-data/",
        "https://coinshares.com/insights/research-data/?page=1",
        "https://coinshares.com/insights/research-data/?page=2",
    ]


def test_dimension_key_is_canonical_and_contract_is_frozen() -> None:
    row = ObservationInput(
        metric_code="crypto.etf.net_flow_usd",
        value=Decimal("10"),
        effective_at=NOW,
        dimensions={"fund": "IBIT", "asset": "BTC"},
    )
    assert row.dimension_key == '{"asset":"BTC","fund":"IBIT"}'
    with pytest.raises(FrozenInstanceError):
        row.metric_code = "crypto.changed"  # type: ignore[misc]


def test_observation_period_requires_both_boundaries_and_ends_at_effective_time() -> None:
    with pytest.raises(ValueError, match="both be present"):
        ObservationInput(
            metric_code="macro.calendar.event",
            value=Decimal("1"),
            effective_at=NOW,
            effective_start=NOW - timedelta(hours=1),
        )
    with pytest.raises(ValueError, match="period end"):
        ObservationInput(
            metric_code="macro.calendar.event",
            value=Decimal("1"),
            effective_at=NOW,
            effective_start=NOW - timedelta(hours=2),
            effective_end=NOW - timedelta(hours=1),
        )


def test_snapshot_and_source_run_require_aware_ordered_timestamps() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        RawSnapshot(
            content=b"{}",
            content_type="application/json",
            source_url="https://example.test/source",
            effective_at=None,
            published_at=None,
            observed_at=datetime(2026, 8, 13),
        )
    with pytest.raises(ValueError, match="before it started"):
        SourceRunResult(
            source_code="alternative-fng",
            status="succeeded",
            records_fetched=1,
            error_code=None,
            retry_count=0,
            started_at=NOW,
            finished_at=NOW - timedelta(seconds=1),
        )


def test_http_transport_rejects_redirects_and_oversized_bodies() -> None:
    redirected = UrllibTransport(
        opener=FakeOpener(
            FakeResponse(b"{}", url="https://redirected.example.test/source")
        )
    )
    with pytest.raises(SourceFetchError) as redirect_error:
        redirected.fetch(
            "https://example.test/source", timeout_seconds=1, max_bytes=100
        )
    assert redirect_error.value.code == "REDIRECT_REJECTED"
    assert "redirected.example.test" not in str(redirect_error.value)

    oversized = UrllibTransport(
        opener=FakeOpener(
            FakeResponse(b"12345", headers={"Content-Length": "5"})
        )
    )
    with pytest.raises(SourceFetchError) as size_error:
        oversized.fetch(
            "https://example.test/source", timeout_seconds=1, max_bytes=4
        )
    assert size_error.value.code == "RESPONSE_TOO_LARGE"


def test_http_transport_retries_rate_limit_and_caps_retry_after() -> None:
    url = "https://example.test/source"
    opener = FakeOpener(
        http_error(url, 429, {"Retry-After": "120"}),
        http_error(url, 429, {"Retry-After": "120"}),
        http_error(url, 429, {"Retry-After": "120"}),
    )
    sleeps: list[float] = []
    transport = UrllibTransport(opener=opener, sleep=sleeps.append)

    with pytest.raises(SourceFetchError) as error:
        transport.fetch(url, timeout_seconds=1, max_bytes=100)

    assert error.value.code == "RATE_LIMITED"
    assert opener.attempts == 3
    assert sleeps == [60.0, 60.0]
    assert "upstream detail" not in str(error.value)


def test_http_transport_maps_timeout_and_invalid_json_to_stable_codes() -> None:
    timeout_transport = UrllibTransport(
        opener=FakeOpener(URLError(socket.timeout("private timeout detail")))
    )
    with pytest.raises(SourceFetchError) as timeout_error:
        timeout_transport.fetch(
            "https://example.test/source", timeout_seconds=1, max_bytes=100
        )
    assert timeout_error.value.code == "TIMEOUT"

    json_transport = UrllibTransport(
        opener=FakeOpener(FakeResponse(b"not-json"))
    )
    with pytest.raises(SourceFetchError) as json_error:
        json_transport.post_json(
            "https://example.test/source",
            {"request": "value"},
            headers={},
            timeout_seconds=1,
            max_bytes=100,
        )
    assert json_error.value.code == "INVALID_RESPONSE"


def _scrapling_client_module():
    return importlib.import_module("smart_insights.scrapling_client")


def _scrapling_response(**overrides: object) -> SimpleNamespace:
    values: dict[str, object] = {
        "url": "https://farside.co.uk/btc/",
        "status": 200,
        "body": b"<html><table><tr><td>flow</td></tr></table></html>",
        "headers": {"content-type": "text/html; charset=utf-8"},
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_scrapling_creates_bounded_private_html_snapshot() -> None:
    module = _scrapling_client_module()
    response = _scrapling_response()
    client = module.ScraplingClient(
        fetcher=lambda _url: response,
        clock=lambda: NOW,
    )

    result = client.scrape(
        source_for_code("farside-btc-etf"), "https://farside.co.uk/btc/"
    )

    assert json.loads(result.content) == {
        "metadata": {
            "sourceURL": "https://farside.co.uk/btc/",
            "statusCode": 200,
        },
        "rawHtml": response.body.decode(),
    }
    assert result.observed_at == NOW
    assert result.metadata == {
        "collector": "scrapling",
        "parser_version": "farside-btc-v1",
    }


def test_scrapling_decodes_html_with_declared_charset() -> None:
    module = _scrapling_client_module()
    response = _scrapling_response(
        body=b"<html><p>caf\xe9</p></html>",
        headers={"content-type": "text/html; charset=ISO-8859-1"},
    )
    client = module.ScraplingClient(fetcher=lambda _url: response)

    result = client.scrape(
        source_for_code("farside-btc-etf"), "https://farside.co.uk/btc/"
    )

    assert json.loads(result.content)["rawHtml"] == "<html><p>café</p></html>"


def test_scrapling_rejects_unknown_declared_charset() -> None:
    module = _scrapling_client_module()
    response = _scrapling_response(
        headers={"content-type": "text/html; charset=not-a-real-charset"},
    )
    client = module.ScraplingClient(fetcher=lambda _url: response)

    with pytest.raises(SourceFetchError) as error:
        client.scrape(
            source_for_code("farside-btc-etf"), "https://farside.co.uk/btc/"
        )

    assert error.value.code == "INVALID_RESPONSE"


def test_scrapling_rejects_outside_url_before_fetch() -> None:
    module = _scrapling_client_module()
    calls: list[str] = []
    client = module.ScraplingClient(fetcher=lambda url: calls.append(url))

    with pytest.raises(ValueError, match="allow-listed"):
        client.scrape(
            source_for_code("farside-btc-etf"), "https://evil.invalid/source"
        )

    assert calls == []


@pytest.mark.parametrize(
    ("response", "expected_code", "expected_status"),
    (
        (
            _scrapling_response(url="https://evil.invalid/source"),
            "REDIRECT_REJECTED",
            None,
        ),
        (_scrapling_response(status=403), "HTTP_ERROR", 403),
        (
            _scrapling_response(headers={"content-type": "application/json"}),
            "INVALID_RESPONSE",
            None,
        ),
    ),
)
def test_scrapling_rejects_invalid_html_responses(
    response: SimpleNamespace, expected_code: str, expected_status: int | None
) -> None:
    module = _scrapling_client_module()
    client = module.ScraplingClient(fetcher=lambda _url: response)

    with pytest.raises(SourceFetchError) as error:
        client.scrape(
            source_for_code("farside-btc-etf"), "https://farside.co.uk/btc/"
        )

    assert error.value.code == expected_code
    assert error.value.status_code == expected_status


def test_scrapling_caps_html_and_download_bytes() -> None:
    module = _scrapling_client_module()
    html_client = module.ScraplingClient(
        fetcher=lambda _url: _scrapling_response(body=b"x" * 101),
        max_html_bytes=100,
    )
    with pytest.raises(SourceFetchError) as html_error:
        html_client.scrape(
            source_for_code("farside-btc-etf"), "https://farside.co.uk/btc/"
        )
    assert html_error.value.code == "RESPONSE_TOO_LARGE"

    image_client = module.ScraplingClient(
        fetcher=lambda _url: _scrapling_response(
            body=b"x" * 101,
            headers={"content-type": "image/png"},
        ),
        max_image_bytes=100,
    )
    with pytest.raises(SourceFetchError) as image_error:
        image_client.download(
            source_for_code("farside-btc-etf"),
            "https://farside.co.uk/btc/",
            content_types=frozenset({"image/png"}),
        )
    assert image_error.value.code == "RESPONSE_TOO_LARGE"


def test_scrapling_download_requires_allowlisted_image_content_type() -> None:
    module = _scrapling_client_module()
    response = _scrapling_response(
        body=b"png-bytes", headers={"content-type": "image/png"}
    )
    client = module.ScraplingClient(fetcher=lambda _url: response, clock=lambda: NOW)

    asset = client.download(
        source_for_code("farside-btc-etf"),
        "https://farside.co.uk/btc/",
        content_types=frozenset({"image/png", "image/jpeg", "image/webp"}),
    )

    assert asset.content == b"png-bytes"
    assert asset.content_type == "image/png"
    assert asset.source_url == "https://farside.co.uk/btc/"
    assert asset.observed_at == NOW


def test_scrapling_default_fetcher_uses_local_scrapling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _scrapling_client_module()
    calls: list[tuple[str, str, bool, int]] = []

    class Fetcher:
        @staticmethod
        def get(
            url: str, *, impersonate: str, stealthy_headers: bool, timeout: int
        ) -> SimpleNamespace:
            calls.append((url, impersonate, stealthy_headers, timeout))
            return SimpleNamespace(
                body=b"<html></html>",
                headers={"content-type": "text/html"},
                status=200,
                url=url,
            )

    package = ModuleType("scrapling")
    package.__path__ = []  # type: ignore[attr-defined]
    fetchers = ModuleType("scrapling.fetchers")
    fetchers.Fetcher = Fetcher  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "scrapling", package)
    monkeypatch.setitem(sys.modules, "scrapling.fetchers", fetchers)
    monkeypatch.setenv(
        "SMART_INSIGHTS_SCRAPLING_PYTHON", "must-not-use-isolated-python.exe"
    )

    response = module._fetch("https://farside.co.uk/btc/")

    assert response.body == b"<html></html>"
    assert response.status == 200
    assert calls == [
        (
            "https://farside.co.uk/btc/",
            "chrome",
            True,
            30,
        )
    ]


def test_artifact_store_is_atomic_and_content_addressed(tmp_path: Path) -> None:
    stored = ArtifactStore(tmp_path).write(snapshot(), "farside-btc-etf")

    assert stored.content_hash == hashlib.sha256(b"payload").hexdigest()
    assert stored.locator == (
        f"farside-btc-etf/2026/08/{stored.content_hash}.json.gz"
    )
    assert ArtifactStore(tmp_path).read(stored.locator) == b"payload"
    assert not list(tmp_path.rglob("*.tmp"))


def test_artifact_store_rejects_traversal_and_hash_mismatch(tmp_path: Path) -> None:
    store = ArtifactStore(tmp_path)
    with pytest.raises(ValueError, match="inside"):
        store.read("../outside.json.gz")

    stored = store.write(snapshot(), "farside-btc-etf")
    artifact_path = tmp_path.joinpath(*stored.locator.split("/"))
    artifact_path.write_bytes(artifact_path.read_bytes() + b"tampered")
    with pytest.raises(ArtifactIntegrityError, match="checksum"):
        store.read(stored.locator)


def test_validation_rejects_naive_time_before_non_finite_value() -> None:
    with pytest.raises(ObservationValidationError) as error:
        validate_observations(
            source_for_code("alternative-fng"),
            [
                ObservationInput(
                    metric_code="crypto.fear_greed.index",
                    value=Decimal("NaN"),
                    effective_at=datetime(2026, 8, 13),
                )
            ],
        )
    assert error.value.code == "INVALID_TIMESTAMP"


def test_validation_rejects_duplicates_unknown_metrics_and_source_row_overflow() -> None:
    source = replace(source_for_code("alternative-fng"), max_rows=1)
    row = ObservationInput(
        metric_code="crypto.fear_greed.index",
        value=Decimal("10"),
        effective_at=NOW,
    )
    with pytest.raises(ObservationValidationError) as overflow:
        validate_observations(source, [row, row])
    assert overflow.value.code == "INVALID_RESPONSE"

    with pytest.raises(ObservationValidationError) as unknown:
        validate_observations(
            source_for_code("alternative-fng"),
            [row],
            known_metric_codes={"crypto.other"},
        )
    assert unknown.value.code == "MISSING_REQUIRED_FIELD"

    with pytest.raises(ObservationValidationError) as duplicate:
        validate_observations(
            source_for_code("alternative-fng"), [row, row]
        )
    assert duplicate.value.code == "DUPLICATE_CONFLICT"


def test_cli_selection_never_accepts_a_url_or_cross_schedule_source() -> None:
    assert select_sources("daily", source_code="alternative-fng") == (
        source_for_code("alternative-fng"),
    )
    with pytest.raises(ValueError, match="registered"):
        select_sources("daily", source_code="https://evil.invalid")
    with pytest.raises(ValueError, match="schedule"):
        select_sources("weekly", source_code="alternative-fng")


def test_cli_dry_run_lists_disabled_registered_sources_without_collecting() -> None:
    outcomes, exit_code = run_collection(
        "daily", source_code=None, dry_run=True, collectors={}
    )

    assert exit_code == 0
    assert len(outcomes) == 14
    assert {
        outcome.source_code
        for outcome in outcomes
        if outcome.source_code in {"blockchaincenter-altcoin-season", "cbbi-public"}
    } == {"blockchaincenter-altcoin-season", "cbbi-public"}
    assert any(
        outcome.source_code == "mempool-btc-large-addresses"
        and outcome.status == "dry_run"
        for outcome in outcomes
    )
    assert all(outcome.status == "dry_run" for outcome in outcomes)
