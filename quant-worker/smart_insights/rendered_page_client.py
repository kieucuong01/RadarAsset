from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from tempfile import TemporaryDirectory
import time
from typing import Any

from .contracts import CollectionMode, RawSnapshot, SourceDefinition
from .http import SourceFetchError
from .sources import is_source_url_allowed


@dataclass(frozen=True, slots=True)
class BrowserHtmlResult:
    html: str
    final_url: str


RenderedPageReady = Callable[[str], bool]


async def _poll_rendered_html(
    page: Any,
    *,
    ready: RenderedPageReady,
    timeout_seconds: float,
    poll_interval_seconds: float,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> str:
    deadline = monotonic() + timeout_seconds
    while True:
        try:
            html = await page.get_content()
        except Exception:
            html = ""
        if isinstance(html, str) and html.strip() and ready(html):
            return html
        if monotonic() >= deadline:
            raise SourceFetchError("SCHEMA_DRIFT")
        await sleep(poll_interval_seconds)


async def _close_nodriver_resources(browser: Any, process: Any) -> None:
    try:
        if browser is not None:
            targets = tuple(getattr(browser, "targets", ()))
            if targets:
                try:
                    await asyncio.wait_for(
                        asyncio.gather(
                            *(target.aclose() for target in targets),
                            return_exceptions=True,
                        ),
                        timeout=2,
                    )
                except asyncio.TimeoutError:
                    pass
            try:
                await asyncio.wait_for(browser.aclose(), timeout=2)
            except Exception:
                pass
    finally:
        if process is not None:
            try:
                if getattr(process, "returncode", None) is None:
                    process.terminate()
                await asyncio.wait_for(process.wait(), timeout=3)
            except asyncio.TimeoutError:
                try:
                    process.kill()
                    await asyncio.wait_for(process.wait(), timeout=1)
                except (asyncio.TimeoutError, OSError, ProcessLookupError):
                    pass
            except (OSError, ProcessLookupError):
                pass


async def _fetch_with_nodriver(
    url: str,
    *,
    ready: RenderedPageReady,
    poll_timeout_seconds: float,
    poll_interval_seconds: float,
    timezone_id: str,
) -> BrowserHtmlResult:
    try:
        import nodriver
    except Exception as error:
        raise SourceFetchError("BROWSER_LAUNCH_FAILED") from error

    browser = None
    process = None
    with TemporaryDirectory(
        prefix="smart-insights-rendered-", ignore_cleanup_errors=True
    ) as profile_dir:
        try:
            try:
                browser = await nodriver.start(
                    headless=False,
                    browser_args=[
                        "--window-position=-32000,-32000",
                        "--window-size=800,600",
                    ],
                    user_data_dir=profile_dir,
                )
            except Exception as error:
                raise SourceFetchError("BROWSER_LAUNCH_FAILED") from error
            process = getattr(browser, "_process", None)
            page = await browser.get("about:blank")
            await page.send(
                nodriver.cdp.emulation.set_timezone_override(
                    timezone_id=timezone_id
                )
            )
            page = await page.get(url)
            html = await _poll_rendered_html(
                page,
                ready=ready,
                timeout_seconds=poll_timeout_seconds,
                poll_interval_seconds=poll_interval_seconds,
            )
            final_url = await page.evaluate(
                "window.location.href", return_by_value=True
            )
            return BrowserHtmlResult(
                html=html,
                final_url=final_url if isinstance(final_url, str) else "",
            )
        finally:
            await _close_nodriver_resources(browser, process)


class NodriverRenderedPageClient:
    def __init__(
        self,
        *,
        browser_fetch: Callable[[str, RenderedPageReady], BrowserHtmlResult]
        | None = None,
        clock: Callable[[], datetime] | None = None,
        timeout_seconds: float = 60,
        poll_timeout_seconds: float = 45,
        poll_interval_seconds: float = 1,
        max_html_bytes: int = 20_000_000,
        timezone_id: str = "UTC",
    ) -> None:
        if (
            min(
                timeout_seconds,
                poll_timeout_seconds,
                poll_interval_seconds,
                max_html_bytes,
            )
            <= 0
        ):
            raise ValueError("Rendered-page limits must be positive.")
        if not timezone_id.strip():
            raise ValueError("Rendered-page timezone is required.")
        self._browser_fetch = browser_fetch
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._timeout_seconds = timeout_seconds
        self._poll_timeout_seconds = poll_timeout_seconds
        self._poll_interval_seconds = poll_interval_seconds
        self._max_html_bytes = max_html_bytes
        self._timezone_id = timezone_id

    def scrape(
        self,
        source: SourceDefinition,
        url: str,
        *,
        ready: RenderedPageReady,
    ) -> RawSnapshot:
        if source.collection_mode is not CollectionMode.SCRAPLING:
            raise ValueError("Source is not configured for rendered crawling.")
        if not is_source_url_allowed(source, url):
            raise ValueError("URL is not allow-listed for this source.")
        fetch = self._browser_fetch or self._default_browser_fetch
        result = fetch(url, ready)
        if result.final_url != url:
            raise SourceFetchError("REDIRECT_REJECTED")
        if not isinstance(result.html, str) or not result.html.strip() or not ready(
            result.html
        ):
            raise SourceFetchError("SCHEMA_DRIFT")
        encoded = result.html.encode("utf-8")
        if len(encoded) > self._max_html_bytes:
            raise SourceFetchError("RESPONSE_TOO_LARGE")
        return RawSnapshot(
            content=json.dumps(
                {"rawHtml": result.html, "metadata": {"sourceURL": url}},
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8"),
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=self._clock(),
            metadata={
                "collector": "nodriver",
                "parser_version": source.parser_version,
                "timezone": self._timezone_id,
            },
        )

    def _default_browser_fetch(
        self, url: str, ready: RenderedPageReady
    ) -> BrowserHtmlResult:
        try:
            return asyncio.run(
                asyncio.wait_for(
                    _fetch_with_nodriver(
                        url,
                        ready=ready,
                        poll_timeout_seconds=self._poll_timeout_seconds,
                        poll_interval_seconds=self._poll_interval_seconds,
                        timezone_id=self._timezone_id,
                    ),
                    timeout=self._timeout_seconds,
                )
            )
        except SourceFetchError:
            raise
        except (asyncio.TimeoutError, TimeoutError) as error:
            raise SourceFetchError("TIMEOUT") from error
        except Exception as error:
            raise SourceFetchError("INVALID_RESPONSE") from error
