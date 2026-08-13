from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from typing import Any
from urllib.parse import urlencode

from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.http import SourceFetchError, UrllibTransport
from smart_insights.macro_registry import FRED_SERIES, FredSeriesDefinition
from smart_insights.sources import source_for_code

from . import CollectionBatch


class FredCollector:
    def __init__(
        self,
        *,
        api_key: str,
        transport: Any | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("FRED_API_KEY is required for live collection.")
        self.source = source_for_code("fred")
        self._api_key = api_key
        self._transport = transport or UrllibTransport()
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def collect(
        self, series: FredSeriesDefinition, start: date, end: date
    ) -> CollectionBatch:
        if FRED_SERIES.get(series.series_id) != series:
            raise ValueError("FRED series must be allow-listed.")
        if start > end:
            raise ValueError("FRED observation range is invalid.")
        query = urlencode(
            {
                "series_id": series.series_id,
                "api_key": self._api_key,
                "file_type": "json",
                "observation_start": start.isoformat(),
                "observation_end": end.isoformat(),
                "sort_order": "asc",
                "limit": str(self.source.max_rows),
            }
        )
        request_url = f"{self.source.urls[0]}?{query}"
        response = self._transport.fetch(
            request_url, timeout_seconds=30, max_bytes=10_000_000
        )
        if response.status != 200 or response.url != request_url:
            raise SourceFetchError("INVALID_RESPONSE")
        observed_at = self._clock()
        snapshot = RawSnapshot(
            content=response.body,
            content_type="application/json",
            source_url=self.source.urls[0],
            effective_at=None,
            published_at=None,
            observed_at=observed_at,
            metadata={
                "provider_series": series.series_id,
                "unit": series.unit,
                "frequency": series.frequency,
                "parser_version": self.source.parser_version,
            },
        )
        try:
            payload = json.loads(response.body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return CollectionBatch(self.source, snapshot, (), "INVALID_RESPONSE")
        raw_rows = payload.get("observations") if isinstance(payload, dict) else None
        if not isinstance(raw_rows, list):
            return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
        if len(raw_rows) > self.source.max_rows:
            return CollectionBatch(self.source, snapshot, (), "RESPONSE_TOO_LARGE")
        observations: list[ObservationInput] = []
        seen_dates: set[date] = set()
        for raw in raw_rows:
            if not isinstance(raw, dict):
                return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
            raw_date = raw.get("date")
            raw_value = raw.get("value")
            if not isinstance(raw_date, str) or not isinstance(raw_value, str):
                return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
            try:
                effective_date = date.fromisoformat(raw_date)
            except ValueError:
                return CollectionBatch(self.source, snapshot, (), "INVALID_TIMESTAMP")
            if effective_date in seen_dates:
                return CollectionBatch(self.source, snapshot, (), "DUPLICATE_PERIOD")
            seen_dates.add(effective_date)
            if not start <= effective_date <= end:
                return CollectionBatch(self.source, snapshot, (), "OUT_OF_RANGE")
            if raw_value == ".":
                continue
            try:
                value = Decimal(raw_value)
            except InvalidOperation:
                return CollectionBatch(self.source, snapshot, (), "INVALID_VALUE")
            if not value.is_finite():
                return CollectionBatch(self.source, snapshot, (), "INVALID_VALUE")
            observations.append(
                ObservationInput(
                    metric_code=series.metric_code,
                    value=value,
                    effective_at=datetime.combine(
                        effective_date, datetime.min.time(), tzinfo=timezone.utc
                    ),
                    dimensions={
                        "provider_series": series.series_id,
                        "unit": series.unit,
                    },
                )
            )
        return CollectionBatch(self.source, snapshot, tuple(observations))
