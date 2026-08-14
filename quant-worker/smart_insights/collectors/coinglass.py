from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from html.parser import HTMLParser
import json
import re
from typing import Any

from smart_insights.contracts import ObservationInput
from smart_insights.sources import source_for_code

from . import CollectionBatch


_MARGIN_HEADERS = (
    "Time",
    "Annualized Interest Rate",
    "Daily Interest Rate",
    "Hourly Interest Rate",
)
_MAXPAIN_HEADERS = (
    "Coin",
    "Current Price",
    "Short Max Pain Price",
    "Short Distance",
    "Short Max Pain Level",
    "Long Max Pain Price",
    "Long Distance",
    "Long Max Pain Level",
)
_DEFAULT_SYMBOLS = frozenset({"BTC", "ETH", "SOL"})


def _text(value: str) -> str:
    return " ".join(value.replace("\xa0", " ").split())


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(
        self, tag: str, _attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag == "table":
            if self._table is not None:
                raise ValueError("SCHEMA_DRIFT")
            self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in {"th", "td"} and self._row is not None:
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"th", "td"} and self._cell is not None and self._row is not None:
            self._row.append(_text("".join(self._cell)))
            self._cell = None
        elif tag == "tr" and self._row is not None and self._table is not None:
            if any(self._row):
                self._table.append(self._row)
            self._row = None
        elif tag == "table" and self._table is not None:
            self.tables.append(self._table)
            self._table = None


def _matching_table(html: str, headers: tuple[str, ...]) -> list[list[str]]:
    if not isinstance(html, str) or not html.strip():
        raise ValueError("SCHEMA_DRIFT")
    parser = _TableParser()
    try:
        parser.feed(html)
        parser.close()
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("SCHEMA_DRIFT") from error
    matches = [table for table in parser.tables if table and tuple(table[0]) == headers]
    if len(matches) != 1:
        raise ValueError("SCHEMA_DRIFT")
    return matches[0]


def parse_percent(text: str) -> Decimal:
    if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?%", text):
        raise ValueError("INVALID_VALUE")
    value = Decimal(text[:-1])
    if not value.is_finite():
        raise ValueError("INVALID_VALUE")
    return value


def parse_compact_usd(text: str) -> Decimal:
    match = re.fullmatch(
        r"\$?([+-]?\d+(?:\.\d+)?)([KMB])?", text.replace(",", "")
    )
    if not match:
        raise ValueError("INVALID_VALUE")
    multiplier = {
        "K": Decimal("1000"),
        "M": Decimal("1000000"),
        "B": Decimal("1000000000"),
        None: Decimal("1"),
    }[match.group(2)]
    value = Decimal(match.group(1)) * multiplier
    if not value.is_finite():
        raise ValueError("INVALID_VALUE")
    return value


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("observed_at must be timezone-aware.")
    return value.astimezone(timezone.utc)


def parse_margin_table(html: str, observed_at: datetime) -> list[ObservationInput]:
    observed_utc = _aware_utc(observed_at)
    table = _matching_table(html, _MARGIN_HEADERS)
    seen: set[datetime] = set()
    observations: list[ObservationInput] = []
    for cells in table[1:]:
        if not any(cells):
            continue
        if len(cells) != len(_MARGIN_HEADERS) or not all(cells):
            raise ValueError("SCHEMA_DRIFT")
        try:
            effective_at = datetime.strptime(cells[0], "%Y-%m-%d %H:%M").replace(
                tzinfo=timezone.utc
            )
        except ValueError as error:
            raise ValueError("INVALID_TIMESTAMP") from error
        if effective_at.minute or effective_at.second or effective_at.microsecond:
            raise ValueError("INVALID_TIMESTAMP")
        if effective_at > observed_utc + timedelta(minutes=5):
            raise ValueError("INVALID_TIMESTAMP")
        if effective_at in seen:
            raise ValueError("DUPLICATE_PERIOD")
        seen.add(effective_at)
        values = tuple(parse_percent(cell) for cell in cells[1:])
        for code, value, field in zip(
            (
                "crypto.derivatives.margin_borrow.annualized_rate",
                "crypto.derivatives.margin_borrow.daily_rate",
                "crypto.derivatives.margin_borrow.hourly_rate",
            ),
            values,
            ("annualized", "daily", "hourly"),
            strict=True,
        ):
            observations.append(
                ObservationInput(
                    metric_code=code,
                    value=value,
                    effective_at=effective_at,
                    asset_symbol="USDT",
                    dimensions={
                        "exchange": "Binance",
                        "quote_asset": "USDT",
                        "field": field,
                        "timezone": "UTC",
                    },
                )
            )
    if not observations:
        raise ValueError("SCHEMA_DRIFT")
    return observations


def parse_maxpain_table(
    html: str,
    observed_at: datetime,
    symbols: frozenset[str],
) -> list[ObservationInput]:
    observed_utc = _aware_utc(observed_at)
    table = _matching_table(html, _MAXPAIN_HEADERS)
    seen: set[str] = set()
    observations: list[ObservationInput] = []
    for cells in table[1:]:
        if not any(cells):
            continue
        if len(cells) != len(_MAXPAIN_HEADERS) or not all(cells):
            raise ValueError("SCHEMA_DRIFT")
        asset = cells[0].upper()
        if asset not in symbols:
            continue
        if asset in seen:
            raise ValueError("DUPLICATE_ASSET")
        seen.add(asset)
        current = parse_compact_usd(cells[1])
        short_price = parse_compact_usd(cells[2])
        short_distance = parse_percent(cells[3]) / Decimal("100")
        short_level = parse_compact_usd(cells[4])
        long_price = parse_compact_usd(cells[5])
        long_distance = parse_percent(cells[6]) / Decimal("100")
        long_level = parse_compact_usd(cells[7])
        if current <= 0 or min(short_price, short_level, long_price, long_level) < 0:
            raise ValueError("INVALID_VALUE")
        expected_short = (short_price - current) / current
        expected_long = (long_price - current) / current
        if (
            abs(short_distance - expected_short) > Decimal("0.0002")
            or abs(long_distance - expected_long) > Decimal("0.0002")
        ):
            raise ValueError("INVALID_DISTANCE")
        common = {"range": "24h"}
        values = (
            ("crypto.derivatives.liquidation.current_price_usd", current, common),
            (
                "crypto.derivatives.liquidation.short_max_pain_price_usd",
                short_price,
                {**common, "side": "short"},
            ),
            (
                "crypto.derivatives.liquidation.short_distance_ratio",
                short_distance,
                {**common, "side": "short"},
            ),
            (
                "crypto.derivatives.liquidation.short_max_pain_level_usd",
                short_level,
                {**common, "side": "short"},
            ),
            (
                "crypto.derivatives.liquidation.long_max_pain_price_usd",
                long_price,
                {**common, "side": "long"},
            ),
            (
                "crypto.derivatives.liquidation.long_distance_ratio",
                long_distance,
                {**common, "side": "long"},
            ),
            (
                "crypto.derivatives.liquidation.long_max_pain_level_usd",
                long_level,
                {**common, "side": "long"},
            ),
        )
        observations.extend(
            ObservationInput(
                metric_code=code,
                value=value,
                effective_at=observed_utc,
                asset_symbol=asset,
                dimensions=dimensions,
            )
            for code, value, dimensions in values
        )
    if not observations:
        raise ValueError("SCHEMA_DRIFT")
    return observations


def _snapshot_html(snapshot: Any) -> str:
    try:
        payload = json.loads(snapshot.content)
        html = payload["rawHtml"]
    except (KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("SCHEMA_DRIFT") from error
    if not isinstance(html, str):
        raise ValueError("SCHEMA_DRIFT")
    return html


class CoinGlassMarginCollector:
    source_code = "coinglass-margin-borrow"

    def __init__(self, *, crawler: Any) -> None:
        self.source = source_for_code(self.source_code)
        self._crawler = crawler

    def collect(self, as_of: datetime) -> CollectionBatch:
        _aware_utc(as_of)
        snapshot = self._crawler.scrape(
            self.source,
            self.source.urls[0],
            ready=lambda html: (
                "Annualized Interest Rate" in html
                and re.search(r"\d+(?:\.\d+)?%", html) is not None
            ),
        )
        try:
            observations = parse_margin_table(
                _snapshot_html(snapshot), snapshot.observed_at
            )
        except ValueError as error:
            return CollectionBatch(self.source, snapshot, (), str(error))
        return CollectionBatch(self.source, snapshot, tuple(observations))


class CoinGlassMaxPainCollector:
    source_code = "coinglass-liquidation-maxpain"

    def __init__(
        self, *, crawler: Any, symbols: frozenset[str] = _DEFAULT_SYMBOLS
    ) -> None:
        if not symbols:
            raise ValueError("At least one crypto symbol is required.")
        self.source = source_for_code(self.source_code)
        self._crawler = crawler
        self._symbols = symbols

    def collect(self, as_of: datetime) -> CollectionBatch:
        _aware_utc(as_of)
        snapshot = self._crawler.scrape(
            self.source,
            self.source.urls[0],
            ready=lambda html: (
                "Short Max Pain" in html
                and "Long Max Pain" in html
                and re.search(r">\s*BTC\s*<", html, re.IGNORECASE) is not None
            ),
        )
        try:
            observations = parse_maxpain_table(
                _snapshot_html(snapshot),
                snapshot.observed_at,
                symbols=self._symbols,
            )
        except ValueError as error:
            return CollectionBatch(self.source, snapshot, (), str(error))
        return CollectionBatch(self.source, snapshot, tuple(observations))
