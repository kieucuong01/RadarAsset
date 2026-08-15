from __future__ import annotations

from collections.abc import Callable
import csv
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from io import StringIO
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
        api_key: str | None,
        transport: Any | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.source = source_for_code("fred")
        self._api_key = api_key or None
        self._transport = transport or UrllibTransport()
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def collect(
        self, series: FredSeriesDefinition, start: date, end: date
    ) -> CollectionBatch:
        if FRED_SERIES.get(series.series_id) != series:
            raise ValueError("FRED series must be allow-listed.")
        if start > end:
            raise ValueError("FRED observation range is invalid.")
        if self._api_key is not None:
            source_url = self.source.urls[0]
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
        else:
            source_url = self.source.urls[1]
            query = urlencode(
                {
                    "id": series.series_id,
                    "cosd": start.isoformat(),
                    "coed": end.isoformat(),
                }
            )
        request_url = f"{source_url}?{query}"
        response = self._transport.fetch(
            request_url, timeout_seconds=30, max_bytes=10_000_000
        )
        if response.status != 200 or response.url != request_url:
            raise SourceFetchError("INVALID_RESPONSE")
        observed_at = self._clock()
        snapshot = RawSnapshot(
            content=response.body,
            content_type=("application/json" if self._api_key is not None else "text/csv"),
            source_url=source_url,
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
        if self._api_key is not None:
            try:
                payload = json.loads(response.body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                return CollectionBatch(self.source, snapshot, (), "INVALID_RESPONSE")
            raw_rows = payload.get("observations") if isinstance(payload, dict) else None
            if not isinstance(raw_rows, list):
                return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
        else:
            try:
                decoded = response.body.decode("utf-8-sig")
                reader = csv.DictReader(StringIO(decoded))
                if reader.fieldnames != ["observation_date", series.series_id]:
                    return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
                raw_rows = [
                    {"date": row.get("observation_date"), "value": row.get(series.series_id)}
                    for row in reader
                ]
            except (UnicodeDecodeError, csv.Error):
                return CollectionBatch(self.source, snapshot, (), "INVALID_RESPONSE")
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
