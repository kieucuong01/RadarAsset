from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from email.message import Message
import hashlib
import importlib
import json
from pathlib import Path
import socket
from types import SimpleNamespace
from urllib.error import HTTPError, URLError

import pytest

import collect_smart_insights
from collect_smart_insights import run_collection, select_sources
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
        "cftc-disaggregated",
        "cftc-legacy",
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
        "mempool-space",
        "wgc-central-bank",
        "wgc-gold-etf",
    )
    assert ENABLED_SOURCE_CODES == {
        "alternative-fng",
        "coinmetrics-community",
        "defillama-chains",
        "defillama-stablecoins",
        "deribit-public",
        "mempool-space",
    }
    assert {
        code for code in SOURCE_CODES if source_for_code(code).enabled
    } == ENABLED_SOURCE_CODES
    assert source_for_code("fred").license_scope is LicenseScope.PUBLIC_OFFICIAL
    assert source_for_code("fred").quality_tier == Decimal("1.00")
    assert source_for_code("farside-btc-etf").quality_tier == Decimal("0.70")
    assert source_for_code("bitinfocharts-top-addresses").quality_tier == Decimal(
        "0.50"
    )
    assert tuple(source.code for source in sources_for_schedule("daily")) == (
        "alternative-fng",
        "coinmetrics-community",
        "defillama-chains",
        "defillama-stablecoins",
        "deribit-public",
        "mempool-space",
    )


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

    wgc = source_for_code("wgc-gold-etf")
    assert is_source_url_allowed(
        wgc, "https://www.gold.org/download/file/12345/gold-etf-flows.xlsx"
    )
    assert not is_source_url_allowed(
        wgc, "https://www.gold.org/download/file/12345/gold-etf-flows.pdf"
    )


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


def _crawl4ai_client_class():
    return importlib.import_module(
        "smart_insights.crawl4ai_client"
    ).Crawl4AIClient


def _crawl4ai_result(**overrides: object) -> SimpleNamespace:
    values: dict[str, object] = {
        "success": True,
        "url": "https://farside.co.uk/btc/",
        "status_code": 200,
        "markdown": "| Date | Flow |\n|---|---:|\n| 13 Aug | 10 |",
        "html": "<table><tr><td>13 Aug</td><td>10</td></tr></table>",
        "error_message": "",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_crawl4ai_rejects_url_outside_source_allowlist_before_browser_run() -> None:
    calls: list[str] = []
    client = _crawl4ai_client_class()(runner=lambda url: calls.append(url))
    with pytest.raises(ValueError, match="allow-listed"):
        client.scrape(
            source_for_code("farside-btc-etf"), "https://evil.invalid/source"
        )
    assert calls == []


def test_crawl4ai_creates_private_snapshot_for_matching_source_url() -> None:
    response = _crawl4ai_result()
    client = _crawl4ai_client_class()(runner=lambda _url: response, clock=lambda: NOW)

    result = client.scrape(
        source_for_code("farside-btc-etf"), "https://farside.co.uk/btc/"
    )

    assert result.source_url == "https://farside.co.uk/btc/"
    assert result.observed_at == NOW
    assert json.loads(result.content) == {
        "markdown": response.markdown,
        "metadata": {
            "sourceURL": "https://farside.co.uk/btc/",
            "statusCode": 200,
        },
        "rawHtml": response.html,
    }
    assert result.metadata == {
        "collector": "crawl4ai",
        "parser_version": "farside-btc-v1",
    }


def test_crawl4ai_rejects_changed_final_url() -> None:
    mismatched = _crawl4ai_client_class()(
        runner=lambda _url: _crawl4ai_result(url="https://evil.invalid/source"),
        clock=lambda: NOW,
    )
    with pytest.raises(SourceFetchError) as error:
        mismatched.scrape(
            source_for_code("farside-btc-etf"), "https://farside.co.uk/btc/"
        )
    assert error.value.code == "REDIRECT_REJECTED"


def test_crawl4ai_rejects_empty_extraction() -> None:
    client = _crawl4ai_client_class()(
        runner=lambda _url: _crawl4ai_result(markdown="", html=""),
        clock=lambda: NOW,
    )
    with pytest.raises(SourceFetchError) as error:
        client.scrape(
            source_for_code("farside-btc-etf"), "https://farside.co.uk/btc/"
        )
    assert error.value.code == "INVALID_RESPONSE"


def test_crawl4ai_caps_serialized_snapshot_size() -> None:
    client = _crawl4ai_client_class()(
        runner=lambda _url: _crawl4ai_result(markdown="x" * 500),
        clock=lambda: NOW,
        max_bytes=100,
    )
    with pytest.raises(SourceFetchError) as error:
        client.scrape(
            source_for_code("farside-btc-etf"), "https://farside.co.uk/btc/"
        )
    assert error.value.code == "RESPONSE_TOO_LARGE"


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
    assert len(outcomes) == 11
    assert all(outcome.status == "dry_run" for outcome in outcomes)
