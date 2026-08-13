from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import datetime, timezone
import json
from typing import Any

from .contracts import CollectionMode, RawSnapshot, SourceDefinition
from .http import SourceFetchError
from .sources import is_source_url_allowed


def _markdown_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    raw_markdown = getattr(value, "raw_markdown", None)
    return raw_markdown if isinstance(raw_markdown, str) else ""


async def _crawl(url: str) -> Any:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

    browser_config = BrowserConfig(headless=True, verbose=False)
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        check_robots_txt=True,
        page_timeout=30_000,
        process_iframes=False,
        remove_overlay_elements=True,
    )
    async with AsyncWebCrawler(config=browser_config) as crawler:
        return await crawler.arun(url=url, config=run_config)


def _run_crawl4ai(url: str) -> Any:
    return asyncio.run(_crawl(url))


class Crawl4AIClient:
    def __init__(
        self,
        *,
        runner: Callable[[str], Any] | None = None,
        clock: Callable[[], datetime] | None = None,
        max_bytes: int = 20_000_000,
    ) -> None:
        if max_bytes <= 0:
            raise ValueError("Crawl response size limit must be positive.")
        self._runner = runner or _run_crawl4ai
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._max_bytes = max_bytes

    def scrape(self, source: SourceDefinition, url: str) -> RawSnapshot:
        if source.collection_mode is not CollectionMode.CRAWL4AI:
            raise ValueError("Source is not configured for Crawl4AI.")
        if not is_source_url_allowed(source, url):
            raise ValueError("URL is not allow-listed for this source.")
        try:
            result = self._runner(url)
        except SourceFetchError:
            raise
        except Exception as error:
            raise SourceFetchError("NETWORK_ERROR") from error

        final_url = getattr(result, "url", None)
        if not isinstance(final_url, str):
            raise SourceFetchError("INVALID_RESPONSE")
        if final_url != url:
            raise SourceFetchError("REDIRECT_REJECTED")
        status_code = getattr(result, "status_code", None)
        if not isinstance(status_code, int):
            raise SourceFetchError("INVALID_RESPONSE")
        if getattr(result, "success", None) is not True or not 200 <= status_code < 400:
            raise SourceFetchError("HTTP_ERROR" if status_code >= 400 else "NETWORK_ERROR")

        markdown = _markdown_text(getattr(result, "markdown", ""))
        html = getattr(result, "html", "")
        html = html if isinstance(html, str) else ""
        if not markdown.strip() and not html.strip():
            raise SourceFetchError("INVALID_RESPONSE")
        data = {
            "markdown": markdown,
            "rawHtml": html,
            "metadata": {"sourceURL": final_url, "statusCode": status_code},
        }
        content = json.dumps(
            data, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        if len(content) > self._max_bytes:
            raise SourceFetchError("RESPONSE_TOO_LARGE")
        return RawSnapshot(
            content=content,
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=self._clock(),
            metadata={"collector": "crawl4ai", "parser_version": source.parser_version},
        )
