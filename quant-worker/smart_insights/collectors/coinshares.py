from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import json
import re
from typing import Any

from smart_insights.contracts import ObservationInput
from smart_insights.parsers.markdown_table import MarkdownTable, parse_markdown_table
from smart_insights.sources import is_source_url_allowed, source_for_code

from . import CollectionBatch


_PERIOD = re.compile(
    r"data\s+available\s+as\s+(?:at\s+)?close\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})",
    re.IGNORECASE,
)
_PUBLISHED = re.compile(
    r"published\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})", re.IGNORECASE
)


def _date(value: str) -> datetime:
    for date_format in ("%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(value, date_format).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError("INVALID_TIMESTAMP")


def _millions(value: str) -> Decimal:
    cleaned = value.strip().replace(",", "").replace("$", "")
    if cleaned in {"", "-", "—", "–"}:
        return Decimal("0")
    negative = cleaned.startswith("(") and cleaned.endswith(")")
    if negative:
        cleaned = cleaned[1:-1]
    try:
        result = Decimal(cleaned) * Decimal("1000000")
    except InvalidOperation as error:
        raise ValueError("INVALID_VALUE") from error
    return -result if negative else result


class CoinSharesCollector:
    def __init__(self, *, crawler: Any, report_url: str) -> None:
        self.source = source_for_code("coinshares-weekly")
        if not is_source_url_allowed(self.source, report_url):
            raise ValueError("Report URL is not allow-listed.")
        self._crawler = crawler
        self._report_url = report_url

    def collect(self, as_of: datetime) -> CollectionBatch:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        snapshot = self._crawler.scrape(self.source, self._report_url)
        try:
            payload = json.loads(snapshot.content)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return CollectionBatch(self.source, snapshot, (), "INVALID_RESPONSE")
        markdown = payload.get("markdown") if isinstance(payload, dict) else None
        if not isinstance(markdown, str):
            return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
        period_match = _PERIOD.search(markdown)
        published_match = _PUBLISHED.search(markdown)
        if period_match is None:
            return CollectionBatch(self.source, snapshot, (), "MISSING_PERIOD")
        if published_match is None:
            return CollectionBatch(self.source, snapshot, (), "MISSING_PUBLISHED_AT")
        try:
            effective_at = _date(period_match.group(1))
            published_at = _date(published_match.group(1))
            asset_table = parse_markdown_table(
                markdown, required_headers=("Asset", "Week flow", "AUM")
            )
            region_table = parse_markdown_table(
                markdown, required_headers=("Region", "Week flow", "AUM")
            )
            observations = self._observations(
                asset_table,
                dimension="asset",
                effective_at=effective_at,
                published_at=published_at,
            ) + self._observations(
                region_table,
                dimension="region",
                effective_at=effective_at,
                published_at=published_at,
            )
        except ValueError as error:
            return CollectionBatch(self.source, snapshot, (), str(error))
        if effective_at > published_at or published_at > as_of:
            return CollectionBatch(self.source, snapshot, (), "INVALID_TIMESTAMP")
        return CollectionBatch(self.source, snapshot, tuple(observations))

    @staticmethod
    def _observations(
        table: MarkdownTable,
        *,
        dimension: str,
        effective_at: datetime,
        published_at: datetime,
    ) -> list[ObservationInput]:
        label_header = next(
            header for header in table.headers if header.casefold() == dimension
        )
        flow_header = next(
            header for header in table.headers if header.casefold() == "week flow"
        )
        aum_header = next(
            header for header in table.headers if header.casefold() == "aum"
        )
        observations: list[ObservationInput] = []
        labels: set[str] = set()
        for row in table.rows:
            label = row[label_header].strip()
            normalized = label.casefold()
            if not label or normalized in labels:
                raise ValueError("DUPLICATE_SERIES")
            labels.add(normalized)
            common_dimensions = {dimension: label, "source_unit": "US$m"}
            period_start = effective_at - timedelta(days=6)
            for metric_code, header in (
                ("crypto.coinshares.net_flow_usd", flow_header),
                ("crypto.coinshares.aum_usd", aum_header),
            ):
                observations.append(
                    ObservationInput(
                        metric_code=metric_code,
                        value=_millions(row[header]),
                        effective_at=effective_at,
                        effective_start=period_start,
                        effective_end=effective_at,
                        published_at=published_at,
                        dimensions=common_dimensions,
                    )
                )
        return observations
