from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from html.parser import HTMLParser
import json
import re
from typing import Any

from smart_insights.contracts import ObservationInput
from smart_insights.sources import source_for_code

from . import CollectionBatch


_HORIZONS = (
    ("season_90d", "Altcoin Season Index"),
    ("month", "Altcoin Month Index"),
    ("year", "Altcoin Year Index"),
)


class _SectionTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sections: list[str] = []
        self.all_text: list[str] = []
        self._depth = 0
        self._current: list[str] = []

    def handle_starttag(
        self, tag: str, _attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag == "section":
            if self._depth == 0:
                self._current = []
            self._depth += 1

    def handle_data(self, data: str) -> None:
        self.all_text.append(data)
        if self._depth:
            self._current.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "section" and self._depth:
            self._depth -= 1
            if self._depth == 0:
                self.sections.append(" ".join(" ".join(self._current).split()))


def classify_altcoin_season(value: int | Decimal) -> str:
    normalized = Decimal(value)
    if not Decimal("0") <= normalized <= Decimal("100"):
        raise ValueError("INVALID_VALUE")
    if normalized <= 25:
        return "bitcoin_season"
    if normalized >= 75:
        return "altcoin_season"
    return "neutral"


def parse_altcoin_season(
    html: str, observed_at: datetime
) -> list[ObservationInput]:
    if observed_at.tzinfo is None or observed_at.utcoffset() is None:
        raise ValueError("observed_at must be timezone-aware.")
    if not isinstance(html, str) or not html.strip():
        raise ValueError("SCHEMA_DRIFT")
    parser = _SectionTextParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception as error:
        raise ValueError("SCHEMA_DRIFT") from error
    page_text = " ".join(" ".join(parser.all_text).split())
    if (
        re.search(
            r"75%.*last season \(90 days\).*Altcoin Season",
            page_text,
            re.IGNORECASE,
        )
        is None
        or re.search(
            r"25% or less.*Bitcoin Season", page_text, re.IGNORECASE
        )
        is None
    ):
        raise ValueError("SCHEMA_DRIFT")
    values: list[tuple[str, Decimal]] = []
    for horizon, label in _HORIZONS:
        matches = []
        pattern = re.compile(rf"^{re.escape(label)}\s+(\d+(?:\.\d+)?)\b")
        for section in parser.sections:
            match = pattern.search(section)
            if match:
                matches.append(Decimal(match.group(1)))
        if len(matches) != 1:
            raise ValueError("SCHEMA_DRIFT")
        if not Decimal("0") <= matches[0] <= Decimal("100"):
            raise ValueError("INVALID_VALUE")
        values.append((horizon, matches[0]))
    effective_at = observed_at.astimezone(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return [
        ObservationInput(
            metric_code="crypto.cycle.altcoin_season.index",
            value=value,
            effective_at=effective_at,
            dimensions={
                "horizon": horizon,
                "classification": classify_altcoin_season(value),
            },
        )
        for horizon, value in values
    ]


class BlockchainCenterAltcoinSeasonCollector:
    source_code = "blockchaincenter-altcoin-season"

    def __init__(self, *, crawler: Any) -> None:
        self.source = source_for_code(self.source_code)
        self._crawler = crawler

    def collect(self, as_of: datetime) -> CollectionBatch:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        snapshot = self._crawler.scrape(self.source, self.source.urls[0])
        try:
            payload = json.loads(snapshot.content)
            html = payload["rawHtml"]
            if not isinstance(html, str):
                raise ValueError("SCHEMA_DRIFT")
            observations = parse_altcoin_season(html, snapshot.observed_at)
        except (KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
            return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
        except ValueError as error:
            return CollectionBatch(self.source, snapshot, (), str(error))
        return CollectionBatch(self.source, snapshot, tuple(observations))
