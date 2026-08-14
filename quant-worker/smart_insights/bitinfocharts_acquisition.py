from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from html import escape
from io import BytesIO
import json
from tempfile import TemporaryDirectory
import time
from typing import Any
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup, Tag

from .contracts import CollectionMode, RawSnapshot, SourceDefinition
from .http import SourceFetchError
from .sources import is_source_url_allowed


_REQUIRED_HEADERS = ("Address", "Balance", "First In", "Last In")
_CHALLENGE_MARKERS = (
    "cf-chl",
    "challenge-platform",
    "just a moment",
    "verify you are human",
)


def _cell_text(cell: Tag) -> str:
    return " ".join(cell.stripped_strings)


def _ranked_rows(table: Tag, *, skip_header: bool) -> list[tuple[int, list[Tag]]]:
    rows: list[tuple[int, list[Tag]]] = []
    for index, row in enumerate(table.find_all("tr")):
        if skip_header and index == 0:
            continue
        cells = row.find_all(("td", "th"), recursive=False)
        if len(cells) < 5:
            continue
        try:
            rank = int(_cell_text(cells[0]))
        except ValueError:
            continue
        rows.append((rank, cells))
    return rows


def _address_from_cell(cell: Tag, source_url: str) -> tuple[str, str]:
    links = tuple(cell.select('a[href*="/bitcoin/address/"]'))
    if len(links) != 1:
        raise SourceFetchError("SCHEMA_DRIFT")
    href = links[0].get("href")
    if not isinstance(href, str):
        raise SourceFetchError("SCHEMA_DRIFT")
    resolved = urlsplit(urljoin(source_url, href))
    expected = urlsplit(source_url)
    prefix = "/bitcoin/address/"
    if (
        resolved.scheme != "https"
        or resolved.netloc != expected.netloc
        or resolved.username
        or resolved.password
        or not resolved.path.startswith(prefix)
        or resolved.query
        or resolved.fragment
    ):
        raise SourceFetchError("SCHEMA_DRIFT")
    address = resolved.path[len(prefix) :]
    if not address or "/" in address:
        raise SourceFetchError("SCHEMA_DRIFT")

    link_text = _cell_text(links[0])
    full_text = _cell_text(cell)
    suffix = (
        full_text[len(link_text) :].strip()
        if full_text.startswith(link_text)
        else full_text
    )
    return address, suffix


def normalize_bitinfocharts_html(
    html: str,
    *,
    source_url: str = "https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html",
    max_html_bytes: int = 20_000_000,
) -> str:
    if not isinstance(html, str) or not html.strip():
        raise SourceFetchError("INVALID_RESPONSE")
    if len(html.encode("utf-8")) > max_html_bytes:
        raise SourceFetchError("RESPONSE_TOO_LARGE")

    soup = BeautifulSoup(html, "html.parser")
    tables = tuple(soup.find_all("table"))
    if len(tables) > 50:
        raise SourceFetchError("SCHEMA_DRIFT")
    rows = tuple(soup.find_all("tr"))
    if len(rows) > 500 or any(
        len(row.find_all(("td", "th"), recursive=False)) > 100 for row in rows
    ):
        raise SourceFetchError("SCHEMA_DRIFT")
    primary: list[Tag] = []
    for table in tables:
        first_row = table.find("tr")
        headers = (
            tuple(
                _cell_text(cell)
                for cell in first_row.find_all(("th", "td"), recursive=False)
            )
            if first_row
            else ()
        )
        if all(required in headers for required in _REQUIRED_HEADERS):
            primary.append(table)
    if len(primary) != 1:
        raise SourceFetchError("SCHEMA_DRIFT")

    primary_rows = _ranked_rows(primary[0], skip_header=True)
    continuation = [
        rows
        for table in tables
        if table is not primary[0]
        if (rows := _ranked_rows(table, skip_header=False))
        if 20 in {rank for rank, _cells in rows}
        and 100 in {rank for rank, _cells in rows}
    ]
    if len(continuation) != 1:
        raise SourceFetchError("SCHEMA_DRIFT")

    ranked: dict[int, list[Tag]] = {}
    for rank, cells in (*primary_rows, *continuation[0]):
        if rank in ranked or not 1 <= rank <= 100:
            raise SourceFetchError("SCHEMA_DRIFT")
        ranked[rank] = cells
    if set(ranked) != set(range(1, 101)):
        raise SourceFetchError("SCHEMA_DRIFT")

    output = [
        "<table><thead><tr><th></th><th>Address</th><th>Balance</th>",
        "<th>First In</th><th>Last In</th></tr></thead><tbody>",
    ]
    for rank in range(1, 101):
        cells = ranked[rank]
        address, suffix = _address_from_cell(cells[1], source_url)
        address_text = f"{address} {suffix}".strip()
        values = (
            str(rank),
            address_text,
            _cell_text(cells[2]),
            _cell_text(cells[3]),
            _cell_text(cells[4]),
        )
        output.append(
            "<tr>" + "".join(f"<td>{escape(value)}</td>" for value in values) + "</tr>"
        )
    output.append("</tbody></table>")
    return "".join(output)


def convert_bitinfocharts_html(
    html: str,
    *,
    source_url: str,
    converter: Any | None = None,
) -> str:
    canonical = normalize_bitinfocharts_html(html, source_url=source_url)
    if converter is None:
        from markitdown import MarkItDown

        converter = MarkItDown()
    result = converter.convert_stream(
        BytesIO(canonical.encode("utf-8")),
        file_extension=".html",
        url=source_url,
    )
    markdown = getattr(result, "text_content", None)
    if not isinstance(markdown, str) or not markdown.strip():
        raise SourceFetchError("INVALID_RESPONSE")
    return markdown


@dataclass(frozen=True, slots=True)
class BrowserHtmlResult:
    html: str
    final_url: str


async def poll_bitinfocharts_html(
    page: Any,
    *,
    timeout_seconds: float,
    poll_interval_seconds: float,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> str:
    if timeout_seconds <= 0 or poll_interval_seconds <= 0:
        raise ValueError("Polling limits must be positive.")
    deadline = monotonic() + timeout_seconds
    saw_challenge = False
    while True:
        try:
            html = await page.get_content()
        except Exception:
            html = ""
        lowered = html.casefold() if isinstance(html, str) else ""
        current_challenge = any(
            marker in lowered for marker in _CHALLENGE_MARKERS
        )
        saw_challenge = saw_challenge or current_challenge
        if (
            isinstance(html, str)
            and "/bitcoin/address/" in html
            and all(header.casefold() in lowered for header in _REQUIRED_HEADERS)
            and not current_challenge
        ):
            return html
        if monotonic() >= deadline:
            raise SourceFetchError(
                "CHALLENGE_REQUIRED" if saw_challenge else "MISSING_TABLE"
            )
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
    poll_timeout_seconds: float,
    poll_interval_seconds: float,
) -> BrowserHtmlResult:
    try:
        import nodriver
    except Exception as error:
        raise SourceFetchError("BROWSER_LAUNCH_FAILED") from error

    browser = None
    process = None
    with TemporaryDirectory(
        prefix="smart-insights-bitinfocharts-", ignore_cleanup_errors=True
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
            page = await browser.get(url)
            html = await poll_bitinfocharts_html(
                page,
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


def _default_browser_fetch(
    url: str,
    *,
    timeout_seconds: float,
    poll_timeout_seconds: float,
    poll_interval_seconds: float,
) -> BrowserHtmlResult:
    try:
        return asyncio.run(
            asyncio.wait_for(
                _fetch_with_nodriver(
                    url,
                    poll_timeout_seconds=poll_timeout_seconds,
                    poll_interval_seconds=poll_interval_seconds,
                ),
                timeout=timeout_seconds,
            )
        )
    except SourceFetchError:
        raise
    except (asyncio.TimeoutError, TimeoutError) as error:
        raise SourceFetchError("TIMEOUT") from error
    except Exception as error:
        raise SourceFetchError("INVALID_RESPONSE") from error


class NodriverBitInfoChartsClient:
    def __init__(
        self,
        *,
        browser_fetch: Callable[[str], BrowserHtmlResult] | None = None,
        clock: Callable[[], datetime] | None = None,
        timeout_seconds: float = 60,
        poll_timeout_seconds: float = 45,
        poll_interval_seconds: float = 1,
        max_html_bytes: int = 20_000_000,
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
            raise ValueError("Nodriver limits must be positive.")
        self._browser_fetch = browser_fetch
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._timeout_seconds = timeout_seconds
        self._poll_timeout_seconds = poll_timeout_seconds
        self._poll_interval_seconds = poll_interval_seconds
        self._max_html_bytes = max_html_bytes

    def scrape(self, source: SourceDefinition, url: str) -> RawSnapshot:
        if source.code != "bitinfocharts-top-addresses":
            raise ValueError("Nodriver fallback is restricted to BitInfoCharts.")
        if source.collection_mode is not CollectionMode.SCRAPLING:
            raise ValueError("Source is not configured for browser fallback.")
        if not is_source_url_allowed(source, url):
            raise ValueError("URL is not allow-listed for this source.")
        if self._browser_fetch is None:
            result = _default_browser_fetch(
                url,
                timeout_seconds=self._timeout_seconds,
                poll_timeout_seconds=self._poll_timeout_seconds,
                poll_interval_seconds=self._poll_interval_seconds,
            )
        else:
            result = self._browser_fetch(url)
        if result.final_url != url:
            raise SourceFetchError("REDIRECT_REJECTED")
        if not isinstance(result.html, str) or not result.html.strip():
            raise SourceFetchError("INVALID_RESPONSE")
        if len(result.html.encode("utf-8")) > self._max_html_bytes:
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
            },
        )


class BitInfoChartsCrawler:
    def __init__(
        self,
        *,
        primary: Any,
        fallback: Any,
        markdown_converter: Callable[[str, str], str] | None = None,
    ) -> None:
        self._primary = primary
        self._fallback = fallback
        self._markdown_converter = markdown_converter or (
            lambda html, url: convert_bitinfocharts_html(html, source_url=url)
        )

    def scrape(self, source: SourceDefinition, url: str) -> RawSnapshot:
        try:
            snapshot = self._primary.scrape(source, url)
        except SourceFetchError as error:
            if error.code != "HTTP_ERROR" or error.status_code != 403:
                raise
            snapshot = self._fallback.scrape(source, url)
        try:
            payload = json.loads(snapshot.content)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SourceFetchError("INVALID_RESPONSE") from error
        raw_html = payload.get("rawHtml") if isinstance(payload, dict) else None
        if not isinstance(raw_html, str):
            raise SourceFetchError("INVALID_RESPONSE")
        transport_metadata = payload.get("metadata", {})
        if not isinstance(transport_metadata, dict):
            raise SourceFetchError("INVALID_RESPONSE")
        try:
            markdown = self._markdown_converter(raw_html, url)
        except SourceFetchError:
            raise
        except Exception as error:
            raise SourceFetchError("INVALID_RESPONSE") from error
        content = {
            "markdown": markdown,
            "rawHtml": raw_html,
            "metadata": {**transport_metadata, "sourceURL": url},
        }
        return RawSnapshot(
            content=json.dumps(
                content, ensure_ascii=False, separators=(",", ":"), sort_keys=True
            ).encode("utf-8"),
            content_type="application/json",
            source_url=snapshot.source_url,
            effective_at=snapshot.effective_at,
            published_at=snapshot.published_at,
            observed_at=snapshot.observed_at,
            metadata={**snapshot.metadata, "converter": "markitdown"},
        )
