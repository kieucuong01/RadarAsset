from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from typing import Any

from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.http import SourceFetchError, UrllibTransport
from smart_insights.sources import source_for_code

from . import CollectionBatch


class AlternativeFearGreedCollector:
    def __init__(self, *, transport: Any | None = None) -> None:
        self.source = source_for_code("alternative-fng")
        self._transport = transport or UrllibTransport()

    def collect(self, as_of: datetime) -> CollectionBatch:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        url = self.source.urls[0]
        response = self._transport.fetch(
            url, timeout_seconds=30, max_bytes=5_000_000
        )
        if response.status != 200 or response.url != url:
            raise SourceFetchError("INVALID_RESPONSE")
        snapshot = RawSnapshot(
            content=response.body,
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=as_of,
            metadata={
                "attribution": "Alternative.me",
                "terms_url": self.source.terms_url or "",
                "parser_version": self.source.parser_version,
            },
        )
        try:
            payload = json.loads(response.body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return CollectionBatch(self.source, snapshot, (), "INVALID_RESPONSE")
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
        if not self.source.terms_url:
            return CollectionBatch(self.source, snapshot, (), "MISSING_ATTRIBUTION")

        cutoff = as_of.astimezone(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        observations: list[ObservationInput] = []
        dates: set[datetime] = set()
        for raw in payload["data"]:
            if not isinstance(raw, dict):
                return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
            try:
                value = Decimal(str(raw["value"]))
                timestamp = int(str(raw["timestamp"]))
                effective_at = datetime.fromtimestamp(timestamp, timezone.utc)
            except (
                KeyError,
                TypeError,
                ValueError,
                InvalidOperation,
                OverflowError,
                OSError,
            ):
                return CollectionBatch(self.source, snapshot, (), "INVALID_VALUE")
            if value != value.to_integral_value() or not Decimal("0") <= value <= 100:
                return CollectionBatch(self.source, snapshot, (), "INVALID_VALUE")
            if effective_at != effective_at.replace(
                hour=0, minute=0, second=0, microsecond=0
            ):
                return CollectionBatch(self.source, snapshot, (), "INVALID_TIMESTAMP")
            if effective_at >= cutoff:
                continue
            if effective_at in dates:
                return CollectionBatch(self.source, snapshot, (), "DUPLICATE_PERIOD")
            dates.add(effective_at)
            observations.append(
                ObservationInput(
                    metric_code="crypto.fear_greed.index",
                    value=value,
                    effective_at=effective_at,
                    dimensions={
                        "classification": str(raw.get("value_classification", "")),
                        "attribution": "Alternative.me",
                    },
                )
            )
        observations.sort(key=lambda row: row.effective_at, reverse=True)
        return CollectionBatch(self.source, snapshot, tuple(observations))
