from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

import smart_insights.rendered_page_client as rendered
from smart_insights.http import SourceFetchError
from smart_insights.sources import source_for_code


NOW = datetime(2026, 8, 14, 22, tzinfo=timezone.utc)
URL = "https://www.coinglass.com/pro/i/MarginFeeChart"


def test_rendered_page_client_module_exists() -> None:
    assert rendered is not None


def test_rendered_client_rejects_placeholder_only_html() -> None:
    client = rendered.NodriverRenderedPageClient(
        browser_fetch=lambda *_args, **_kwargs: rendered.BrowserHtmlResult(
            html="<table><tr><td>&nbsp;</td></tr></table>",
            final_url=URL,
        )
    )

    with pytest.raises(SourceFetchError) as error:
        client.scrape(
            source_for_code("coinglass-margin-borrow"),
            URL,
            ready=lambda html: "4.05%" in html,
        )

    assert error.value.code == "SCHEMA_DRIFT"


def test_rendered_client_emits_bounded_snapshot_with_utc_metadata() -> None:
    html = "<table><tr><td>4.05%</td></tr></table>"
    client = rendered.NodriverRenderedPageClient(
        browser_fetch=lambda *_args, **_kwargs: rendered.BrowserHtmlResult(html, URL),
        clock=lambda: NOW,
    )

    snapshot = client.scrape(
        source_for_code("coinglass-margin-borrow"),
        URL,
        ready=lambda value: "4.05%" in value,
    )

    assert snapshot.observed_at == NOW
    assert snapshot.metadata == {
        "collector": "nodriver",
        "parser_version": "coinglass-margin-v1",
        "timezone": "UTC",
    }
    assert json.loads(snapshot.content) == {
        "metadata": {"sourceURL": URL},
        "rawHtml": html,
    }


def test_rendered_client_rejects_redirects_and_oversized_html() -> None:
    source = source_for_code("coinglass-margin-borrow")
    redirecting = rendered.NodriverRenderedPageClient(
        browser_fetch=lambda *_args: rendered.BrowserHtmlResult(
            "<p>ready</p>", "https://evil.invalid/"
        )
    )
    with pytest.raises(SourceFetchError) as redirect_error:
        redirecting.scrape(source, URL, ready=lambda _html: True)
    assert redirect_error.value.code == "REDIRECT_REJECTED"

    oversized = rendered.NodriverRenderedPageClient(
        browser_fetch=lambda *_args: rendered.BrowserHtmlResult("x" * 11, URL),
        max_html_bytes=10,
    )
    with pytest.raises(SourceFetchError) as size_error:
        oversized.scrape(source, URL, ready=lambda _html: True)
    assert size_error.value.code == "RESPONSE_TOO_LARGE"


def test_nodriver_sets_utc_before_navigation_and_always_cleans_up(
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
            return "<table><tr><td>ready</td></tr></table>"

        async def evaluate(self, expression: str, *, return_by_value: bool) -> str:
            calls.append((expression, return_by_value))
            return URL

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

    class Browser:
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
        rendered._fetch_with_nodriver(
            URL,
            ready=lambda html: "ready" in html,
            poll_timeout_seconds=5,
            poll_interval_seconds=1,
            timezone_id="UTC",
        )
    )

    assert result.final_url == URL
    assert profile_path is not None and not profile_path.exists()
    assert calls[:4] == [
        (False, ["--window-position=-32000,-32000", "--window-size=800,600"]),
        "about:blank",
        ("timezone", "UTC"),
        URL,
    ]
    assert calls[-4:] == [
        "target-closed",
        "browser-closed",
        "terminated",
        "process-waited",
    ]


def test_nodriver_cleans_up_after_navigation_failure(
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

        async def get(self, _url: str) -> object:
            raise RuntimeError("navigation failed")

    class Browser:
        _process = Process()
        targets: list[object] = []

        async def get(self, url: str) -> Page:
            calls.append(url)
            return Page()

        async def aclose(self) -> None:
            calls.append("browser-closed")

    async def start(**_kwargs: object) -> Browser:
        return Browser()

    cdp = SimpleNamespace(
        emulation=SimpleNamespace(
            set_timezone_override=lambda *, timezone_id: timezone_id
        )
    )
    monkeypatch.setitem(sys.modules, "nodriver", SimpleNamespace(start=start, cdp=cdp))

    with pytest.raises(RuntimeError, match="navigation failed"):
        asyncio.run(
            rendered._fetch_with_nodriver(
                URL,
                ready=lambda _html: True,
                poll_timeout_seconds=5,
                poll_interval_seconds=1,
                timezone_id="UTC",
            )
        )

    assert calls == [
        "about:blank",
        "timezone-set",
        "browser-closed",
        "terminated",
        "process-waited",
    ]
