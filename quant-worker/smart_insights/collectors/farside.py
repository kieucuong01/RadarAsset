from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from typing import Any

from smart_insights.contracts import ObservationInput
from smart_insights.parsers.markdown_table import parse_markdown_table
from smart_insights.sources import source_for_code

from . import CollectionBatch


_SOURCE_CODES = {
    "BTC": "farside-btc-etf",
    "ETH": "farside-eth-etf",
    "SOL": "farside-sol-etf",
}
_DATE_FORMATS = ("%d %b %Y", "%d %B %Y", "%d/%m/%Y", "%b %d, %Y")
_RECONCILIATION_TOLERANCE = Decimal("100000")


def _date(value: str) -> datetime:
    cleaned = value.strip().rstrip("*")
    for date_format in _DATE_FORMATS:
        try:
            parsed = datetime.strptime(cleaned, date_format)
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError("INVALID_TIMESTAMP")


def _millions_usd(value: str) -> Decimal:
    cleaned = value.strip().replace(",", "").replace("$", "")
    if cleaned in {"", "-", "—", "–", "n/a", "N/A"}:
        return Decimal("0")
    negative = cleaned.startswith("(") and cleaned.endswith(")")
    if negative:
        cleaned = cleaned[1:-1].strip()
    cleaned = cleaned.rstrip("*")
    try:
        amount = Decimal(cleaned) * Decimal("1000000")
    except InvalidOperation as error:
        raise ValueError("INVALID_VALUE") from error
    return -amount if negative else amount


class FarsideEtfCollector:
    def __init__(self, asset: str, *, firecrawl: Any) -> None:
        normalized = asset.upper()
        if normalized not in _SOURCE_CODES:
            raise ValueError("Unsupported ETF asset.")
        self.asset = normalized
        self.source = source_for_code(_SOURCE_CODES[normalized])
        self._firecrawl = firecrawl

    def collect(self, as_of: datetime) -> CollectionBatch:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        snapshot = self._firecrawl.scrape(self.source, self.source.urls[0])
        try:
            payload = json.loads(snapshot.content)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return CollectionBatch(self.source, snapshot, (), "INVALID_RESPONSE")
        markdown = payload.get("markdown") if isinstance(payload, dict) else None
        if not isinstance(markdown, str) or not markdown.strip():
            return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
        try:
            table = parse_markdown_table(
                markdown, required_headers=("Date", "Total")
            )
        except ValueError as error:
            return CollectionBatch(self.source, snapshot, (), str(error))

        date_header = next(header for header in table.headers if header.casefold() == "date")
        total_header = next(
            header for header in table.headers if header.casefold() == "total"
        )
        fund_headers = tuple(
            header
            for header in table.headers
            if header not in {date_header, total_header}
        )
        if not fund_headers:
            return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")

        cutoff = as_of.astimezone(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        observations: list[ObservationInput] = []
        rejected: list[datetime] = []
        seen_dates: set[datetime] = set()
        error_code: str | None = None
        for row in table.rows:
            try:
                effective_at = _date(row[date_header])
                fund_values = {
                    fund: _millions_usd(row[fund]) for fund in fund_headers
                }
                total = _millions_usd(row[total_header])
            except (KeyError, ValueError) as error:
                return CollectionBatch(self.source, snapshot, (), str(error))
            if effective_at >= cutoff:
                continue
            if effective_at in seen_dates:
                return CollectionBatch(self.source, snapshot, (), "DUPLICATE_PERIOD")
            seen_dates.add(effective_at)
            reconciled = sum(fund_values.values(), Decimal("0"))
            if abs(reconciled - total) > _RECONCILIATION_TOLERANCE:
                error_code = "RECONCILIATION_FAILED"
                rejected.append(effective_at)
                continue
            for fund, value in fund_values.items():
                observations.append(
                    ObservationInput(
                        metric_code="crypto.etf.net_flow_usd",
                        value=value,
                        effective_at=effective_at,
                        asset_symbol=self.asset,
                        dimensions={"asset": self.asset, "fund": fund},
                    )
                )
            observations.append(
                ObservationInput(
                    metric_code="crypto.etf.net_flow_usd",
                    value=total,
                    effective_at=effective_at,
                    asset_symbol=self.asset,
                    dimensions={"asset": self.asset, "fund": "TOTAL"},
                )
            )
        return CollectionBatch(
            self.source,
            snapshot,
            tuple(observations),
            error_code,
            tuple(rejected),
        )
