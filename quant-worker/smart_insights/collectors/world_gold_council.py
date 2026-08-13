from __future__ import annotations

import base64
import calendar
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import re
from typing import Any

from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.http import SourceFetchError, UrllibTransport
from smart_insights.parsers.xlsx_table import XlsxTable, read_xlsx_tables
from smart_insights.sources import is_source_url_allowed, source_for_code

from . import CollectionBatch


_SOURCES = {"wgc-gold-etf", "wgc-central-bank"}
_XLSX_LINK = re.compile(
    r"https://www\.gold\.org/download/file/[^\s\)\]\"']+\.xlsx",
    re.IGNORECASE,
)
_UPDATED = re.compile(r"Updated\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})", re.I)
_MONTH = re.compile(r"^(\d{4})-(\d{2})$")


def _normalized(value: str) -> str:
    return " ".join(value.casefold().replace("_", " ").split())


def _period(value: str) -> tuple[datetime, datetime]:
    match = _MONTH.fullmatch(value.strip())
    if match is None:
        raise ValueError("INVALID_PERIOD")
    year, month = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12:
        raise ValueError("INVALID_PERIOD")
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(
        year, month, calendar.monthrange(year, month)[1], tzinfo=timezone.utc
    )
    return start, end


def _decimal(value: str) -> Decimal:
    cleaned = value.strip().replace(",", "")
    try:
        number = Decimal(cleaned)
    except InvalidOperation as error:
        raise ValueError("INVALID_NUMBER") from error
    if not number.is_finite():
        raise ValueError("INVALID_NUMBER")
    return number


def _select_table(
    tables: tuple[XlsxTable, ...], required: tuple[str, ...]
) -> tuple[tuple[str, ...], tuple[tuple[str, ...], ...]]:
    matches = []
    normalized_required = {_normalized(value) for value in required}
    for table in tables:
        for index, row in enumerate(table.rows[:50]):
            headers = tuple(_normalized(value) for value in row)
            if normalized_required <= set(headers):
                matches.append((headers, table.rows[index + 1 :]))
    if len(matches) != 1:
        raise ValueError("SCHEMA_DRIFT")
    return matches[0]


class WorldGoldCouncilCollector:
    def __init__(
        self,
        source_code: str,
        *,
        crawler: Any,
        transport: Any | None = None,
    ) -> None:
        if source_code not in _SOURCES:
            raise ValueError("Unsupported World Gold Council source.")
        self.source = source_for_code(source_code)
        self._crawler = crawler
        self._transport = transport or UrllibTransport()

    def collect(self, as_of: datetime) -> CollectionBatch:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        landing = self._crawler.scrape(self.source, self.source.urls[0])
        try:
            payload = json.loads(landing.content)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return CollectionBatch(self.source, landing, (), "INVALID_RESPONSE")
        markdown = payload.get("markdown") if isinstance(payload, dict) else None
        if not isinstance(markdown, str) or len(markdown.encode("utf-8")) > 100_000:
            return CollectionBatch(self.source, landing, (), "RESPONSE_TOO_LARGE")
        links = tuple(sorted(set(_XLSX_LINK.findall(markdown))))
        if len(links) != 1 or not is_source_url_allowed(self.source, links[0]):
            return CollectionBatch(self.source, landing, (), "SCHEMA_DRIFT")
        download_url = links[0]
        try:
            response = self._transport.fetch(
                download_url, timeout_seconds=30, max_bytes=10_000_000
            )
        except SourceFetchError:
            raise
        if response.status != 200 or response.url != download_url:
            raise SourceFetchError("INVALID_RESPONSE")
        try:
            tables = read_xlsx_tables(response.body)
            observations = self._observations(tables)
        except ValueError as error:
            snapshot = self._snapshot(
                landing, markdown, download_url, response.body, as_of, None
            )
            return CollectionBatch(self.source, snapshot, (), str(error))
        published_at = None
        updated = _UPDATED.search(markdown)
        if updated:
            try:
                published_at = datetime.strptime(
                    updated.group(1), "%d %B %Y"
                ).replace(tzinfo=timezone.utc)
            except ValueError:
                pass
        snapshot = self._snapshot(
            landing,
            markdown,
            download_url,
            response.body,
            as_of,
            max(row.effective_at for row in observations),
            published_at=published_at,
        )
        return CollectionBatch(self.source, snapshot, observations)

    def _observations(
        self, tables: tuple[XlsxTable, ...]
    ) -> tuple[ObservationInput, ...]:
        if self.source.code == "wgc-gold-etf":
            required = ("Period", "Asset", "Flow Tonnes", "Holdings Tonnes")
        else:
            required = ("Period", "Country", "Net Purchase Tonnes")
        headers, rows = _select_table(tables, required)
        indexes = {header: index for index, header in enumerate(headers)}
        observations: list[ObservationInput] = []
        for raw in rows:
            period_value = raw[indexes["period"]].strip() if len(raw) > indexes["period"] else ""
            if not period_value:
                continue
            try:
                start, end = _period(period_value)
            except ValueError:
                if period_value.casefold().startswith(("footnote", "source")):
                    continue
                raise
            if self.source.code == "wgc-gold-etf":
                asset = raw[indexes["asset"]].strip()
                if asset != "GLOBAL_GOLD_ETF":
                    continue
                flow = _decimal(raw[indexes["flow tonnes"]])
                holdings = _decimal(raw[indexes["holdings tonnes"]])
                for metric_code, value in (
                    ("gold.etf_flow_tonnes", flow),
                    ("gold.etf_holdings_tonnes", holdings),
                ):
                    observations.append(
                        ObservationInput(
                            metric_code=metric_code,
                            value=value,
                            effective_at=end,
                            effective_start=start,
                            effective_end=end,
                            asset_symbol="XAU",
                            dimensions={"asset": asset, "frequency": "monthly"},
                        )
                    )
            else:
                country = raw[indexes["country"]].strip()
                value = _decimal(raw[indexes["net purchase tonnes"]])
                if country != "GLOBAL":
                    continue
                observations.append(
                    ObservationInput(
                        metric_code="gold.central_bank_net_purchase_tonnes",
                        value=value,
                        effective_at=end,
                        effective_start=start,
                        effective_end=end,
                        asset_symbol="XAU",
                        dimensions={"country": country, "frequency": "monthly"},
                    )
                )
        if not observations:
            raise ValueError("MISSING_REQUIRED_FIELD")
        return tuple(observations)

    def _snapshot(
        self,
        landing: RawSnapshot,
        markdown: str,
        download_url: str,
        workbook: bytes,
        observed_at: datetime,
        effective_at: datetime | None,
        *,
        published_at: datetime | None = None,
    ) -> RawSnapshot:
        content = json.dumps(
            {
                "landingMarkdown": markdown,
                "workbookBase64": base64.b64encode(workbook).decode("ascii"),
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return RawSnapshot(
            content=content,
            content_type="application/json",
            source_url=landing.source_url,
            effective_at=effective_at,
            published_at=published_at,
            observed_at=observed_at,
            metadata={
                "download_url": download_url,
                "workbook_sha256": hashlib.sha256(workbook).hexdigest(),
                "parser_version": self.source.parser_version,
                "license_scope": "research_only",
            },
        )
