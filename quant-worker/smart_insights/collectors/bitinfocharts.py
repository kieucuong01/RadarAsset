from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import re
from typing import Any

from smart_insights.contracts import ObservationInput
from smart_insights.parsers.markdown_table import parse_markdown_table
from smart_insights.sources import source_for_code

from . import CollectionBatch


_ADDRESS = re.compile(r"\b(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{20,80})\b")
_LABEL = re.compile(r"wallet:\s*(.*?)\s*Balance:", re.IGNORECASE)
_BALANCE = re.compile(r"([\d,]+(?:\.\d+)?)\s*BTC\b", re.IGNORECASE)
_EXCLUSION_PATTERNS = {
    "exchange": (
        "binance",
        "coinbase",
        "bitfinex",
        "kraken",
        "okx",
        "huobi",
        "gemini",
        "bittrex",
        "upbit",
        "bybit",
    ),
    "custodian": ("custodian", "custody", "xapo", "bitgo", "copper"),
    "miner": ("miner", "mining pool"),
    "government": ("government", "department of justice", "doj"),
    "special_entity": ("hack", "recovery", "mtgox", "mt. gox", "satoshi"),
}


def _btc(value: str) -> Decimal:
    match = _BALANCE.search(value)
    if match is None:
        raise ValueError("INVALID_VALUE")
    try:
        result = Decimal(match.group(1).replace(",", ""))
    except InvalidOperation as error:
        raise ValueError("INVALID_VALUE") from error
    if not result.is_finite() or result < 0:
        raise ValueError("INVALID_VALUE")
    return result


def _category(label: str | None) -> str | None:
    if label is None:
        return None
    normalized = label.casefold()
    for category, patterns in _EXCLUSION_PATTERNS.items():
        if any(pattern in normalized for pattern in patterns):
            return category
    return "reviewed_other"


class BitInfoChartsCollector:
    def __init__(self, *, firecrawl: Any) -> None:
        self.source = source_for_code("bitinfocharts-top-addresses")
        self._firecrawl = firecrawl

    def collect(
        self,
        as_of: datetime,
        *,
        previous_balances: Mapping[str, Decimal] | None = None,
    ) -> CollectionBatch:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        snapshot = self._firecrawl.scrape(self.source, self.source.urls[0])
        try:
            payload = json.loads(snapshot.content)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return CollectionBatch(self.source, snapshot, (), "INVALID_RESPONSE")
        markdown = payload.get("markdown") if isinstance(payload, dict) else None
        if not isinstance(markdown, str):
            return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
        try:
            table = parse_markdown_table(
                markdown,
                required_headers=("Address", "Balance", "First In", "Last In"),
            )
            parsed = self._parse_rows(table.headers, table.rows)
        except ValueError as error:
            return CollectionBatch(self.source, snapshot, (), str(error))

        effective_at = as_of.astimezone(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        current_balances = {
            row["address"]: row["balance"]
            for row in parsed
            if row["excluded"] is False
        }
        tracked_balance = sum(
            (row["balance"] for row in parsed), Decimal("0")
        )
        excluded_balance = sum(
            (row["balance"] for row in parsed if row["excluded"]), Decimal("0")
        )
        labelled_balance = sum(
            (row["balance"] for row in parsed if row["label"] is not None),
            Decimal("0"),
        )
        labelled_count = sum(row["label"] is not None for row in parsed)
        excluded_count = sum(row["excluded"] is True for row in parsed)
        coverage = Decimal(labelled_count) / Decimal(len(parsed))
        dimensions = {
            "cohort": "reviewed_non_exchange",
            "label_coverage": format(coverage.quantize(Decimal("0.000001")), "f"),
            "quality_tier": "heuristic",
        }
        observations = [
            self._row("crypto.large_address.tracked_balance_btc", tracked_balance, effective_at, dimensions),
            self._row("crypto.large_address.reviewed_non_exchange_balance_btc", sum(current_balances.values(), Decimal("0")), effective_at, dimensions),
            self._row("crypto.large_address.excluded_balance_btc", excluded_balance, effective_at, dimensions),
            self._row("crypto.large_address.labelled_balance_btc", labelled_balance, effective_at, dimensions),
            self._row("crypto.large_address.tracked_address_count", Decimal(len(parsed)), effective_at, dimensions),
            self._row("crypto.large_address.excluded_address_count", Decimal(excluded_count), effective_at, dimensions),
            self._row("crypto.large_address.labelled_address_count", Decimal(labelled_count), effective_at, dimensions),
            self._row("crypto.large_address.label_coverage", coverage, effective_at, dimensions),
        ]
        if previous_balances is not None:
            if any(value < 0 or not value.is_finite() for value in previous_balances.values()):
                return CollectionBatch(self.source, snapshot, (), "INVALID_PREVIOUS_SNAPSHOT")
            current_keys = set(current_balances)
            previous_keys = set(previous_balances)
            intersection = current_keys & previous_keys
            entrants = current_keys - previous_keys
            exits = previous_keys - current_keys
            intersection_change = sum(
                (current_balances[key] - previous_balances[key] for key in intersection),
                Decimal("0"),
            )
            entrant_balance = sum(
                (current_balances[key] for key in entrants), Decimal("0")
            )
            exit_balance = sum(
                (previous_balances[key] for key in exits), Decimal("0")
            )
            change_dimensions = {
                **dimensions,
                "entrant_count": str(len(entrants)),
                "exit_count": str(len(exits)),
                "intersection_change_btc": format(intersection_change, "f"),
                "entrant_balance_btc": format(entrant_balance, "f"),
                "exit_balance_btc": format(exit_balance, "f"),
            }
            total_change = (
                sum(current_balances.values(), Decimal("0"))
                - sum(previous_balances.values(), Decimal("0"))
            )
            observations.append(
                self._row(
                    "crypto.large_address.balance_change_btc",
                    total_change,
                    effective_at,
                    change_dimensions,
                )
            )
        return CollectionBatch(self.source, snapshot, tuple(observations))

    @staticmethod
    def _parse_rows(
        headers: tuple[str, ...], rows: tuple[Mapping[str, str], ...]
    ) -> list[dict[str, object]]:
        rank_header = next((header for header in headers if not header.strip()), None)
        if rank_header is None:
            raise ValueError("SCHEMA_DRIFT")
        parsed: list[dict[str, object]] = []
        addresses: set[str] = set()
        for row in rows:
            try:
                rank = int(row[rank_header])
            except (KeyError, ValueError) as error:
                raise ValueError("SCHEMA_DRIFT") from error
            if not 1 <= rank <= 100:
                continue
            address_cell = row["Address"]
            address_match = _ADDRESS.search(address_cell)
            if address_match is None:
                raise ValueError("INVALID_ADDRESS")
            address = address_match.group(0)
            if address in addresses:
                raise ValueError("DUPLICATE_SERIES")
            addresses.add(address)
            label_match = _LABEL.search(address_cell)
            label = label_match.group(1).strip() if label_match else None
            category = _category(label)
            parsed.append(
                {
                    "rank": rank,
                    "address": address,
                    "balance": _btc(row["Balance"]),
                    "label": label,
                    "category": category,
                    "excluded": category in _EXCLUSION_PATTERNS,
                }
            )
        if not parsed:
            raise ValueError("SCHEMA_DRIFT")
        return parsed

    @staticmethod
    def _row(
        metric_code: str,
        value: Decimal,
        effective_at: datetime,
        dimensions: Mapping[str, str],
    ) -> ObservationInput:
        return ObservationInput(
            metric_code=metric_code,
            value=value,
            effective_at=effective_at,
            asset_symbol="BTC",
            dimensions=dimensions,
            quality_status="warning",
            quality_flags=("HEURISTIC_ADDRESS_COHORT",),
        )
