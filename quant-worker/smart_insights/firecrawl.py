from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
import json
from typing import Any
from urllib.parse import urlsplit

from .contracts import CollectionMode, RawSnapshot, SourceDefinition
from .http import SourceFetchError, UrllibTransport
from .sources import is_source_url_allowed


class FirecrawlClient:
    def __init__(
        self,
        base_url: str,
        *,
        api_key: str | None = None,
        transport: Any | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        parsed = urlsplit(base_url)
        loopback_http = parsed.scheme == "http" and parsed.hostname in {
            "127.0.0.1",
            "localhost",
            "::1",
        }
        if not (parsed.scheme == "https" or loopback_http) or not parsed.hostname:
            raise ValueError("Firecrawl URL must use HTTPS or loopback HTTP.")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Firecrawl URL must not contain credentials or query data.")
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._transport = transport or UrllibTransport()
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def scrape(self, source: SourceDefinition, url: str) -> RawSnapshot:
        if source.collection_mode is not CollectionMode.CRAWL4AI:
            raise ValueError("Source is not configured for browser collection.")
        if not is_source_url_allowed(source, url):
            raise ValueError("URL is not allow-listed for this source.")
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
        response = self._transport.post_json(
            f"{self._base_url}/v2/scrape",
            {
                "url": url,
                "onlyMainContent": True,
                "timeout": 30_000,
                "formats": ["markdown", "rawHtml"],
            },
            headers=headers,
            timeout_seconds=45,
            max_bytes=20_000_000,
        )
        if response.get("success") is not True:
            raise SourceFetchError("INVALID_RESPONSE")
        data = response.get("data")
        if not isinstance(data, dict):
            raise SourceFetchError("INVALID_RESPONSE")
        metadata = data.get("metadata")
        if not isinstance(metadata, dict) or metadata.get("sourceURL") != url:
            raise SourceFetchError("REDIRECT_REJECTED")
        markdown = data.get("markdown")
        raw_html = data.get("rawHtml")
        if not (
            isinstance(markdown, str)
            and markdown.strip()
            or isinstance(raw_html, str)
            and raw_html.strip()
        ):
            raise SourceFetchError("INVALID_RESPONSE")
        content = json.dumps(
            data, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        return RawSnapshot(
            content=content,
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=self._clock(),
            metadata={"collector": "firecrawl", "parser_version": source.parser_version},
        )
