from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

import smart_insights.bitinfocharts_acquisition as acquisition
from smart_insights.bitinfocharts_acquisition import (
    BitInfoChartsCrawler,
    BrowserHtmlResult,
    NodriverBitInfoChartsClient,
    _bitinfocharts_ready,
    _default_browser_fetch,
    _fetch_with_nodriver,
    convert_bitinfocharts_html,
    normalize_bitinfocharts_html,
    poll_bitinfocharts_html,
)
from smart_insights.contracts import RawSnapshot
from smart_insights.http import SourceFetchError
from smart_insights.parsers.markdown_table import parse_markdown_table
from smart_insights.sources import source_for_code


NOW = datetime(2026, 8, 14, 9, 30, tzinfo=timezone.utc)
URL = "https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html"


def _address(rank: int) -> str:
    return f"1{'A' * 24}{rank:010d}"


def _provider_html(*, row_count: int = 100) -> str:
    rows = []
    for rank in range(1, row_count + 1):
        address = _address(rank)
        label = " wallet: Binance Cold Wallet" if rank == 1 else ""
        rows.append(
            "<tr>"
            f"<td>{rank}</td>"
            f'<td><a href="/bitcoin/address/{address}">truncated</a>{label}</td>'
            f"<td>{10_000 + rank:,} BTC</td>"
            "<td>2020-01-01</td><td>2026-08-14</td>"
            "</tr>"
        )
    first = "".join(rows[:19])
    continuation = "".join(rows[19:])
    return (
        "<html><body>"
        "<table><tr><th>noise</th></tr><tr><td>ignore</td></tr></table>"
        "<table><tr><th></th><th>Address</th><th>Balance</th>"
        "<th>First In</th><th>Last In</th></tr>"
        f"{first}</table>"
        f"<table>{continuation}</table>"
        "</body></html>"
    )


def _provider_html_with_percent_column() -> str:
    return _provider_html().replace(
        "<th>Balance</th><th>First In</th><th>Last In</th>",
        "<th>Balance</th><th>% of coins</th><th>First In</th><th>Last In</th>",
    ).replace(
        "<td>2020-01-01</td><td>2026-08-14</td>",
        "<td>0.0100%</td><td>2020-01-01</td><td>2026-08-14</td>",
    )


def _snapshot(*, collector: str, html: str = "<html></html>") -> RawSnapshot:
    return RawSnapshot(
        content=json.dumps(
            {
                "rawHtml": html,
                "metadata": {"sourceURL": URL, "statusCode": 200},
            }
        ).encode("utf-8"),
        content_type="application/json",
        source_url=URL,
        effective_at=None,
        published_at=None,
        observed_at=NOW,
        metadata={"collector": collector},
    )


def test_normalizer_merges_split_tables_and_uses_full_address_href() -> None:
    normalized = normalize_bitinfocharts_html(_provider_html())

    assert normalized.count("<tr") == 101
    assert _address(1) in normalized
    assert _address(100) in normalized
    assert "truncated" not in normalized
    assert "Binance Cold Wallet" in normalized


def test_normalizer_uses_named_date_columns_when_provider_adds_percent_column() -> None:
    normalized = normalize_bitinfocharts_html(_provider_html_with_percent_column())

    assert "0.0100%" not in normalized
    assert "<td>2020-01-01</td><td>2026-08-14</td>" in normalized


def test_bitinfocharts_ready_waits_for_the_complete_split_table() -> None:
    partial = _provider_html(row_count=19)

    assert not _bitinfocharts_ready(partial)
    assert _bitinfocharts_ready(_provider_html())


@pytest.mark.parametrize("row_count", (99, 101))
def test_normalizer_requires_exact_ranks_one_through_one_hundred(
    row_count: int,
) -> None:
    with pytest.raises(SourceFetchError) as error:
        normalize_bitinfocharts_html(_provider_html(row_count=row_count))

    assert error.value.code == "SCHEMA_DRIFT"


def test_normalizer_rejects_address_links_on_an_unapproved_port() -> None:
    html = _provider_html().replace(
        f'/bitcoin/address/{_address(1)}',
        f'https://bitinfocharts.com:444/bitcoin/address/{_address(1)}',
        1,
    )

    with pytest.raises(SourceFetchError) as error:
        normalize_bitinfocharts_html(html)

    assert error.value.code == "SCHEMA_DRIFT"


def test_markitdown_converter_receives_only_normalized_html() -> None:
    calls: list[tuple[str, str, str]] = []

    class Converter:
        def convert_stream(
            self, stream: object, *, file_extension: str, url: str
        ) -> object:
            html = stream.read().decode("utf-8")
            calls.append((html, file_extension, url))
            return SimpleNamespace(text_content="| | Address | Balance | First In | Last In |")

    markdown = convert_bitinfocharts_html(
        _provider_html(), source_url=URL, converter=Converter()
    )

    assert markdown.startswith("| | Address")
    assert calls[0][1:] == (".html", URL)
    assert calls[0][0].count("<tr") == 101


def test_real_markitdown_output_matches_existing_markdown_parser() -> None:
    markdown = convert_bitinfocharts_html(_provider_html(), source_url=URL)

    table = parse_markdown_table(
        markdown,
        required_headers=("Address", "Balance", "First In", "Last In"),
    )

    assert len(table.rows) == 100
    assert _address(100) in table.rows[-1]["Address"]


class _Primary:
    def __init__(self, result: RawSnapshot | Exception) -> None:
        self.result = result
        self.calls = 0

    def scrape(self, _source: object, _url: str) -> RawSnapshot:
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def test_crawler_falls_back_only_for_scrapling_http_403() -> None:
    primary = _Primary(SourceFetchError("HTTP_ERROR", status_code=403))
    fallback = _Primary(_snapshot(collector="nodriver", html=_provider_html()))
    crawler = BitInfoChartsCrawler(
        primary=primary,
        fallback=fallback,
        markdown_converter=lambda _html, _url: "converted markdown",
    )

    snapshot = crawler.scrape(source_for_code("bitinfocharts-top-addresses"), URL)

    payload = json.loads(snapshot.content)
    assert payload["markdown"] == "converted markdown"
    assert payload["rawHtml"].startswith("<html>")
    assert snapshot.metadata["collector"] == "nodriver"
    assert snapshot.metadata["converter"] == "markitdown"
    assert primary.calls == fallback.calls == 1


def test_crawler_does_not_start_fallback_after_primary_success() -> None:
    primary = _Primary(_snapshot(collector="scrapling", html=_provider_html()))
    fallback = _Primary(AssertionError("fallback must not run"))
    crawler = BitInfoChartsCrawler(
        primary=primary,
        fallback=fallback,
        markdown_converter=lambda _html, _url: "converted markdown",
    )

    snapshot = crawler.scrape(source_for_code("bitinfocharts-top-addresses"), URL)

    assert snapshot.metadata["collector"] == "scrapling"
    assert json.loads(snapshot.content)["metadata"] == {
        "sourceURL": URL,
        "statusCode": 200,
    }
    assert primary.calls == 1
    assert fallback.calls == 0


def test_crawler_maps_converter_failures_to_a_stable_private_error() -> None:
    def fail_conversion(_html: str, _url: str) -> str:
        raise RuntimeError("provider body must not escape")

    crawler = BitInfoChartsCrawler(
        primary=_Primary(_snapshot(collector="scrapling", html=_provider_html())),
        fallback=_Primary(AssertionError("fallback must not run")),
        markdown_converter=fail_conversion,
    )

    with pytest.raises(SourceFetchError) as error:
        crawler.scrape(source_for_code("bitinfocharts-top-addresses"), URL)

    assert error.value.code == "INVALID_RESPONSE"
    assert str(error.value) == "INVALID_RESPONSE"


@pytest.mark.parametrize(
    "error",
    (
        SourceFetchError("HTTP_ERROR", status_code=401),
        SourceFetchError("RATE_LIMITED", status_code=429),
        SourceFetchError("UPSTREAM_SERVER_ERROR", status_code=503),
        SourceFetchError("NETWORK_ERROR"),
    ),
)
def test_crawler_does_not_fallback_for_non_cloudflare_failure(
    error: SourceFetchError,
) -> None:
    primary = _Primary(error)
    fallback = _Primary(_snapshot(collector="nodriver", html=_provider_html()))
    crawler = BitInfoChartsCrawler(
        primary=primary,
        fallback=fallback,
        markdown_converter=lambda _html, _url: "converted markdown",
    )

    with pytest.raises(SourceFetchError) as raised:
        crawler.scrape(source_for_code("bitinfocharts-top-addresses"), URL)

    assert raised.value is error
    assert fallback.calls == 0


def test_polling_ignores_transient_cdp_errors_and_waits_out_challenge() -> None:
    good = _provider_html()

    class Page:
        def __init__(self) -> None:
            self.results: list[str | Exception] = [
                RuntimeError("stale node"),
                "<html><title>Just a moment...</title>cf-chl</html>",
                good,
            ]

        async def get_content(self) -> str:
            result = self.results.pop(0)
            if isinstance(result, Exception):
                raise result
            return result

    sleeps: list[float] = []

    async def sleep(seconds: float) -> None:
        sleeps.append(seconds)

    html = asyncio.run(
        poll_bitinfocharts_html(
            Page(),
            timeout_seconds=5,
            poll_interval_seconds=1,
            monotonic=iter((0.0, 1.0, 2.0, 3.0)).__next__,
            sleep=sleep,
        )
    )

    assert html == good
    assert sleeps == [1, 1]


def test_polling_remembers_a_challenge_through_transient_blank_reads() -> None:
    class Page:
        def __init__(self) -> None:
            self.results = [
                "<html><title>Just a moment...</title>cf-chl</html>",
                "",
            ]

        async def get_content(self) -> str:
            return self.results.pop(0)

    async def sleep(_seconds: float) -> None:
        return None

    with pytest.raises(SourceFetchError) as error:
        asyncio.run(
            poll_bitinfocharts_html(
                Page(),
                timeout_seconds=1,
                poll_interval_seconds=1,
                monotonic=iter((0.0, 0.5, 1.0)).__next__,
                sleep=sleep,
            )
        )

    assert error.value.code == "CHALLENGE_REQUIRED"


def test_polling_reports_missing_table_without_a_challenge() -> None:
    class Page:
        async def get_content(self) -> str:
            return "<html><body>no provider table</body></html>"

    async def sleep(_seconds: float) -> None:
        return None

    with pytest.raises(SourceFetchError) as error:
        asyncio.run(
            poll_bitinfocharts_html(
                Page(),
                timeout_seconds=1,
                poll_interval_seconds=1,
                monotonic=iter((0.0, 1.0)).__next__,
                sleep=sleep,
            )
        )

    assert error.value.code == "MISSING_TABLE"


def test_nodriver_client_rejects_redirects_and_oversized_html() -> None:
    source = source_for_code("bitinfocharts-top-addresses")
    redirecting = NodriverBitInfoChartsClient(
        browser_fetch=lambda _url: BrowserHtmlResult("<html></html>", "https://evil.invalid/")
    )
    with pytest.raises(SourceFetchError) as redirect_error:
        redirecting.scrape(source, URL)
    assert redirect_error.value.code == "REDIRECT_REJECTED"

    valid_html = _provider_html()
    oversized = NodriverBitInfoChartsClient(
        browser_fetch=lambda _url: BrowserHtmlResult(valid_html, URL),
        max_html_bytes=len(valid_html.encode("utf-8")) - 1,
    )
    with pytest.raises(SourceFetchError) as size_error:
        oversized.scrape(source, URL)
    assert size_error.value.code == "RESPONSE_TOO_LARGE"


def test_nodriver_client_is_restricted_to_bitinfocharts_source() -> None:
    source = replace(
        source_for_code("bitinfocharts-top-addresses"),
        code="another-scrapling-source",
    )
    client = NodriverBitInfoChartsClient(
        browser_fetch=lambda _url: BrowserHtmlResult(_provider_html(), URL)
    )

    with pytest.raises(ValueError, match="BitInfoCharts"):
        client.scrape(source, URL)


def test_nodriver_client_delegates_bitinfocharts_readiness_to_shared_renderer() -> None:
    calls: list[tuple[object, str]] = []

    class Renderer:
        def scrape(
            self, source: object, url: str, *, ready: object
        ) -> RawSnapshot:
            assert callable(ready)
            assert ready(_provider_html())
            assert not ready("<html><body>placeholder</body></html>")
            calls.append((source, url))
            return _snapshot(collector="nodriver", html=_provider_html())

    source = source_for_code("bitinfocharts-top-addresses")
    client = NodriverBitInfoChartsClient(renderer=Renderer())

    snapshot = client.scrape(source, URL)

    assert snapshot.source_url == URL
    assert calls == [(source, URL)]


def test_nodriver_launch_uses_fresh_profile_and_awaits_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[object] = []
    profile_path: Path | None = None

    class Page:
        async def send(self, command: object) -> None:
            calls.append(command)

        async def get(self, url: str) -> "Page":
            calls.append(url)
            return self

        async def get_content(self) -> str:
            return _provider_html()

        async def evaluate(
            self, expression: str, *, return_by_value: bool
        ) -> str:
            calls.append((expression, return_by_value))
            return URL

    class Browser:
        class Process:
            returncode: int | None = None

            def terminate(self) -> None:
                calls.append("terminated")
                self.returncode = 0

            async def wait(self) -> int:
                calls.append("process-waited")
                return 0

        class Target:
            async def aclose(self) -> None:
                calls.append("target-closed")

        _process = Process()
        targets = [Target()]

        async def get(self, url: str) -> Page:
            calls.append(url)
            return Page()

        async def aclose(self) -> None:
            calls.append("browser-closed")

    async def start(
        *, headless: bool, browser_args: list[str], user_data_dir: str
    ) -> Browser:
        nonlocal profile_path
        profile_path = Path(user_data_dir)
        assert profile_path.is_dir()
        calls.append((headless, browser_args))
        return Browser()

    cdp = SimpleNamespace(
        emulation=SimpleNamespace(
            set_timezone_override=lambda *, timezone_id: ("timezone", timezone_id)
        )
    )
    monkeypatch.setitem(sys.modules, "nodriver", SimpleNamespace(start=start, cdp=cdp))

    result = asyncio.run(
        _fetch_with_nodriver(
            URL, poll_timeout_seconds=5, poll_interval_seconds=1
        )
    )

    assert result.final_url == URL
    assert profile_path is not None
    assert not profile_path.exists()
    assert calls == [
        (
            True,
            ["--window-size=800,600"],
        ),
        "about:blank",
        ("timezone", "UTC"),
        URL,
        ("window.location.href", True),
        "target-closed",
        "browser-closed",
        "terminated",
        "process-waited",
    ]


def test_nodriver_cleans_up_when_navigation_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    profile_path: Path | None = None

    class Process:
        returncode: int | None = None

        def terminate(self) -> None:
            calls.append("terminated")
            self.returncode = 0

        async def wait(self) -> int:
            calls.append("process-waited")
            return 0

    class Browser:
        _process = Process()
        targets: list[object] = []

        class Page:
            async def send(self, _command: object) -> None:
                calls.append("timezone-set")

            async def get(self, _url: str) -> object:
                raise RuntimeError("navigation failed")

        async def get(self, _url: str) -> "Browser.Page":
            return self.Page()

        async def aclose(self) -> None:
            calls.append("browser-closed")

    async def start(**kwargs: object) -> Browser:
        nonlocal profile_path
        profile_path = Path(str(kwargs["user_data_dir"]))
        return Browser()

    cdp = SimpleNamespace(
        emulation=SimpleNamespace(
            set_timezone_override=lambda *, timezone_id: timezone_id
        )
    )
    monkeypatch.setitem(sys.modules, "nodriver", SimpleNamespace(start=start, cdp=cdp))

    with pytest.raises(RuntimeError, match="navigation failed"):
        asyncio.run(
            _fetch_with_nodriver(
                URL, poll_timeout_seconds=5, poll_interval_seconds=1
            )
        )

    assert profile_path is not None
    assert not profile_path.exists()
    assert calls == [
        "timezone-set",
        "browser-closed",
        "terminated",
        "process-waited",
    ]


def test_nodriver_terminates_process_when_browser_close_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    class Process:
        returncode: int | None = None

        def terminate(self) -> None:
            calls.append("terminated")
            self.returncode = 0

        async def wait(self) -> int:
            calls.append("process-waited")
            return 0

    class Page:
        async def send(self, _command: object) -> None:
            calls.append("timezone-set")

        async def get(self, _url: str) -> "Page":
            return self

        async def get_content(self) -> str:
            return _provider_html()

        async def evaluate(self, *_args: object, **_kwargs: object) -> str:
            return URL

    class Browser:
        _process = Process()
        targets: list[object] = []

        async def get(self, _url: str) -> Page:
            return Page()

        async def aclose(self) -> None:
            calls.append("browser-close-failed")
            raise LookupError("unexpected CDP close failure")

    async def start(**_kwargs: object) -> Browser:
        return Browser()

    cdp = SimpleNamespace(
        emulation=SimpleNamespace(
            set_timezone_override=lambda *, timezone_id: timezone_id
        )
    )
    monkeypatch.setitem(sys.modules, "nodriver", SimpleNamespace(start=start, cdp=cdp))

    result = asyncio.run(
        _fetch_with_nodriver(
            URL, poll_timeout_seconds=5, poll_interval_seconds=1
        )
    )

    assert result.final_url == URL
    assert calls == [
        "timezone-set",
        "browser-close-failed",
        "terminated",
        "process-waited",
    ]


def test_default_browser_fetch_maps_outer_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def never_finishes(*_args: object, **_kwargs: object) -> BrowserHtmlResult:
        await asyncio.sleep(60)
        raise AssertionError("unreachable")

    monkeypatch.setattr(acquisition, "_fetch_with_nodriver", never_finishes)

    with pytest.raises(SourceFetchError) as error:
        _default_browser_fetch(
            URL,
            timeout_seconds=0.01,
            poll_timeout_seconds=1,
            poll_interval_seconds=1,
        )

    assert error.value.code == "TIMEOUT"


def test_nodriver_launch_failure_has_stable_error_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def start(**_kwargs: object) -> object:
        raise FileNotFoundError("Chrome unavailable")

    monkeypatch.setitem(sys.modules, "nodriver", SimpleNamespace(start=start))

    with pytest.raises(SourceFetchError) as error:
        _default_browser_fetch(
            URL,
            timeout_seconds=5,
            poll_timeout_seconds=4,
            poll_interval_seconds=1,
        )

    assert error.value.code == "BROWSER_LAUNCH_FAILED"
