from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
from html.parser import HTMLParser
import json
from typing import Any
from urllib.parse import urljoin

from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.metrics.crypto import CBBI_COMPONENTS
from smart_insights.sources import is_source_url_allowed, source_for_code

from . import CollectionBatch


_CONFIDENCE = "Confidence"
_JSON_URL = "https://colintalkscrypto.com/cbbi/data/latest.json"


class _LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hrefs: list[str] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag != "a":
            return
        for name, value in attrs:
            if name.casefold() == "href" and isinstance(value, str):
                self.hrefs.append(value)


def discover_cbbi_json_url(html: str, page_url: str) -> str:
    if not isinstance(html, str) or not html.strip():
        raise ValueError("SCHEMA_DRIFT")
    parser = _LinkParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception as error:
        raise ValueError("SCHEMA_DRIFT") from error
    matches = [urljoin(page_url, href) for href in parser.hrefs]
    exact = [url for url in matches if url == _JSON_URL]
    if len(exact) != 1:
        raise ValueError("SCHEMA_DRIFT")
    source = source_for_code("cbbi-public")
    if not is_source_url_allowed(source, exact[0]):
        raise ValueError("SCHEMA_DRIFT")
    return exact[0]


def _provider_time(raw: object, *, as_of: datetime) -> datetime:
    if not isinstance(raw, str) or not raw.isascii() or not raw.isdigit():
        raise ValueError("INVALID_TIMESTAMP")
    try:
        value = datetime.fromtimestamp(int(raw), timezone.utc)
    except (ValueError, OverflowError, OSError) as error:
        raise ValueError("INVALID_TIMESTAMP") from error
    if value != value.replace(hour=0, minute=0, second=0, microsecond=0):
        raise ValueError("INVALID_TIMESTAMP")
    if value > as_of:
        raise ValueError("INVALID_TIMESTAMP")
    return value


def _native_value(raw: object) -> Decimal | None:
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        raise ValueError("INVALID_VALUE")
    try:
        value = Decimal(str(raw))
    except InvalidOperation as error:
        raise ValueError("INVALID_VALUE") from error
    if not value.is_finite() or not Decimal("0") <= value <= Decimal("1"):
        raise ValueError("INVALID_VALUE")
    return value


def parse_cbbi_json(content: bytes, *, as_of: datetime) -> list[ObservationInput]:
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware.")
    as_of_utc = as_of.astimezone(timezone.utc)
    try:
        payload = json.loads(content.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("SCHEMA_DRIFT") from error
    if not isinstance(payload, dict):
        raise ValueError("SCHEMA_DRIFT")
    providers = (*CBBI_COMPONENTS.keys(), _CONFIDENCE)
    if any(provider not in payload for provider in providers):
        raise ValueError("SCHEMA_DRIFT")
    observations: list[ObservationInput] = []
    for provider in providers:
        raw_series = payload.get(provider)
        if not isinstance(raw_series, dict) or not raw_series:
            raise ValueError("SCHEMA_DRIFT")
        numeric_count = 0
        points: list[tuple[datetime, Decimal]] = []
        for raw_time, raw_value in raw_series.items():
            effective_at = _provider_time(raw_time, as_of=as_of_utc)
            value = _native_value(raw_value)
            if value is None:
                continue
            numeric_count += 1
            points.append((effective_at, value))
        if numeric_count == 0:
            raise ValueError("SCHEMA_DRIFT")
        metric_code = (
            "crypto.cycle.cbbi.confidence"
            if provider == _CONFIDENCE
            else f"crypto.cycle.cbbi.component.{CBBI_COMPONENTS[provider]}"
        )
        for effective_at, value in sorted(points, key=lambda item: item[0]):
            observations.append(
                ObservationInput(
                    metric_code=metric_code,
                    value=value * Decimal("100"),
                    effective_at=effective_at,
                    dimensions={
                        "provider_component": provider,
                        "provider_scale": "0_to_1",
                    },
                )
            )
    observations.sort(key=lambda row: (row.effective_at, row.metric_code))
    return observations


def _page_html(snapshot: RawSnapshot) -> str:
    try:
        payload = json.loads(snapshot.content)
        html = payload["rawHtml"]
    except (KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("SCHEMA_DRIFT") from error
    if not isinstance(html, str):
        raise ValueError("SCHEMA_DRIFT")
    return html


def _composite_snapshot(
    page: RawSnapshot,
    html: str,
    asset: Any,
    *,
    effective_at: datetime | None,
) -> RawSnapshot:
    content = json.dumps(
        {
            "page": {
                "html": html,
                "sha256": hashlib.sha256(html.encode("utf-8")).hexdigest(),
                "url": page.source_url,
            },
            "data": {
                "contentBase64": base64.b64encode(asset.content).decode("ascii"),
                "sha256": hashlib.sha256(asset.content).hexdigest(),
                "url": asset.source_url,
            },
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    source = source_for_code("cbbi-public")
    return RawSnapshot(
        content=content,
        content_type="application/json",
        source_url=page.source_url,
        effective_at=effective_at,
        published_at=None,
        observed_at=max(page.observed_at, asset.observed_at),
        metadata={
            "collector": "scrapling",
            "parser_version": source.parser_version,
            "companion_url": asset.source_url,
        },
    )


class CbbiCollector:
    source_code = "cbbi-public"

    def __init__(self, *, crawler: Any, backfill: bool = False) -> None:
        self.source = source_for_code(self.source_code)
        self._crawler = crawler
        self._backfill = backfill

    def collect(self, as_of: datetime) -> CollectionBatch:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        page = self._crawler.scrape(self.source, self.source.urls[0])
        try:
            html = _page_html(page)
            json_url = discover_cbbi_json_url(html, page.source_url)
        except ValueError as error:
            return CollectionBatch(self.source, page, (), str(error))
        asset = self._crawler.download_json(self.source, json_url)
        try:
            observations = parse_cbbi_json(asset.content, as_of=as_of)
            if not self._backfill:
                cutoff = as_of.astimezone(timezone.utc).replace(
                    hour=0, minute=0, second=0, microsecond=0
                ) - timedelta(days=6)
                observations = [
                    row for row in observations if row.effective_at >= cutoff
                ]
            if not observations or len(observations) > self.source.max_rows:
                raise ValueError("SCHEMA_DRIFT")
        except ValueError as error:
            snapshot = _composite_snapshot(page, html, asset, effective_at=None)
            return CollectionBatch(self.source, snapshot, (), str(error))
        effective_at = max(row.effective_at for row in observations)
        snapshot = _composite_snapshot(
            page, html, asset, effective_at=effective_at
        )
        return CollectionBatch(self.source, snapshot, tuple(observations))
