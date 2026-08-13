from __future__ import annotations

from collections.abc import Callable, Mapping, Set
from dataclasses import dataclass
from datetime import datetime, timezone
import codecs
from email.message import Message
import json
from typing import Any

from .contracts import CollectionMode, RawSnapshot, SourceDefinition
from .http import SourceFetchError
from .sources import is_source_url_allowed


def _fetch(url: str) -> Any:
    from scrapling.fetchers import Fetcher

    return Fetcher.get(
        url,
        impersonate="chrome",
        stealthy_headers=True,
        timeout=30,
    )


@dataclass(frozen=True, slots=True)
class DownloadedAsset:
    content: bytes
    content_type: str
    source_url: str
    observed_at: datetime
    metadata: Mapping[str, object]


class ScraplingClient:
    def __init__(
        self,
        *,
        fetcher: Callable[[str], Any] | None = None,
        clock: Callable[[], datetime] | None = None,
        max_html_bytes: int = 20_000_000,
        max_image_bytes: int = 10_000_000,
    ) -> None:
        if max_html_bytes <= 0 or max_image_bytes <= 0:
            raise ValueError("Scrapling response limits must be positive.")
        self._fetcher = fetcher or _fetch
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._max_html_bytes = max_html_bytes
        self._max_image_bytes = max_image_bytes

    def scrape(self, source: SourceDefinition, url: str) -> RawSnapshot:
        response = self._request(source, url, max_bytes=self._max_html_bytes)
        content_type = _content_type(response)
        if content_type not in {"text/html", "application/xhtml+xml"}:
            raise SourceFetchError("INVALID_RESPONSE")
        body = _body(response)
        try:
            message = Message()
            message["content-type"] = _content_type_header(response)
            charset = message.get_content_charset() or "utf-8"
            codecs.lookup(charset)
            html = body.decode(charset, errors="strict")
        except (LookupError, UnicodeDecodeError) as error:
            raise SourceFetchError("INVALID_RESPONSE") from error
        if not html.strip():
            raise SourceFetchError("INVALID_RESPONSE")
        data = {
            "rawHtml": html,
            "metadata": {"sourceURL": url, "statusCode": int(response.status)},
        }
        return RawSnapshot(
            content=json.dumps(
                data, ensure_ascii=False, separators=(",", ":"), sort_keys=True
            ).encode("utf-8"),
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=self._clock(),
            metadata={
                "collector": "scrapling",
                "parser_version": source.parser_version,
            },
        )

    def download(
        self,
        source: SourceDefinition,
        url: str,
        *,
        content_types: Set[str],
    ) -> DownloadedAsset:
        if not content_types:
            raise ValueError("At least one download content type is required.")
        response = self._request(source, url, max_bytes=self._max_image_bytes)
        content_type = _content_type(response)
        if content_type not in content_types:
            raise SourceFetchError("INVALID_RESPONSE")
        return DownloadedAsset(
            content=_body(response),
            content_type=content_type,
            source_url=url,
            observed_at=self._clock(),
            metadata={
                "collector": "scrapling",
                "parser_version": source.parser_version,
                "status_code": int(response.status),
            },
        )

    def _request(
        self, source: SourceDefinition, url: str, *, max_bytes: int
    ) -> Any:
        if source.collection_mode is not CollectionMode.SCRAPLING:
            raise ValueError("Source is not configured for Scrapling.")
        if not is_source_url_allowed(source, url):
            raise ValueError("URL is not allow-listed for this source.")
        try:
            response = self._fetcher(url)
        except SourceFetchError:
            raise
        except TimeoutError as error:
            raise SourceFetchError("TIMEOUT") from error
        except Exception as error:
            raise SourceFetchError("NETWORK_ERROR") from error
        final_url = getattr(response, "url", None)
        if final_url != url:
            raise SourceFetchError("REDIRECT_REJECTED")
        status = getattr(response, "status", None)
        if not isinstance(status, int):
            raise SourceFetchError("INVALID_RESPONSE")
        if status == 429:
            raise SourceFetchError("RATE_LIMITED")
        if status >= 500:
            raise SourceFetchError("UPSTREAM_SERVER_ERROR")
        if not 200 <= status < 300:
            raise SourceFetchError("HTTP_ERROR")
        if len(_body(response)) > max_bytes:
            raise SourceFetchError("RESPONSE_TOO_LARGE")
        return response


def _body(response: Any) -> bytes:
    body = getattr(response, "body", None)
    if not isinstance(body, bytes):
        raise SourceFetchError("INVALID_RESPONSE")
    return body


def _content_type(response: Any) -> str:
    return _content_type_header(response).split(";", 1)[0].strip().casefold()


def _content_type_header(response: Any) -> str:
    headers = getattr(response, "headers", None)
    if not isinstance(headers, Mapping):
        raise SourceFetchError("INVALID_RESPONSE")
    return next(
        (
            str(header_value)
            for name, header_value in headers.items()
            if str(name).casefold() == "content-type"
        ),
        "",
    )
