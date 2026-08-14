from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

from smart_insights.event_contracts import EventCollectionBatch, EventInput
from smart_insights.event_normalization import normalize_event
from smart_insights.http import UrllibTransport
from smart_insights.sources import source_for_code

from .event_common import completed, fetch_event_json, optional_nonnegative_int, optional_number, required_str, schema_drift


class UsgsCollector:
    def __init__(self, *, transport: Any | None = None) -> None:
        self.source = source_for_code("usgs-earthquakes")
        self._transport = transport or UrllibTransport()

    def collect(self, *, observed_at: datetime) -> EventCollectionBatch:
        start = observed_at - timedelta(days=1)
        query = urlencode({
            "format": "geojson",
            "starttime": start.isoformat(),
            "endtime": observed_at.isoformat(),
            "minmagnitude": "4.5",
            "limit": "500",
            "orderby": "time-asc",
        })
        request_url = f"{self.source.urls[0]}?{query}"
        fetched = fetch_event_json(source=self.source, transport=self._transport, request_url=request_url, observed_at=observed_at)
        if isinstance(fetched, EventCollectionBatch):
            return fetched
        snapshot, payload = fetched
        try:
            rows = payload["features"] if isinstance(payload, dict) and payload.get("type") == "FeatureCollection" else None
            if not isinstance(rows, list) or len(rows) > 500:
                raise ValueError("rows")
            events = []
            for raw in rows:
                if not isinstance(raw, dict) or raw.get("type") != "Feature":
                    raise ValueError("row")
                props, geometry = raw.get("properties"), raw.get("geometry")
                if not isinstance(props, dict) or not isinstance(geometry, dict) or geometry.get("type") != "Point":
                    raise ValueError("feature")
                coords = geometry.get("coordinates")
                timestamp_ms = props.get("time")
                if not isinstance(coords, list) or len(coords) < 3 or isinstance(timestamp_ms, bool) or not isinstance(timestamp_ms, (int, float)):
                    raise ValueError("feature")
                event_id = required_str(raw.get("id"))
                events.append(normalize_event(EventInput(
                    source_code=self.source.code,
                    source_event_key=event_id,
                    category="earthquake",
                    subcategory=required_str(props.get("type")),
                    title=required_str(props.get("place")),
                    occurred_at=datetime.fromtimestamp(float(timestamp_ms) / 1000, tz=timezone.utc),
                    provider_severity=optional_number(props.get("mag")),
                    country=None,
                    region=required_str(props.get("place")),
                    latitude=float(coords[1]),
                    longitude=float(coords[0]),
                    affected_count=None,
                    fatalities=None,
                    source_url=required_str(props.get("url")),
                    dimensions={
                        "depth_km": float(coords[2]),
                        "felt_reports": optional_nonnegative_int(props.get("felt")),
                        "significance": optional_nonnegative_int(props.get("sig")),
                        "status": required_str(props.get("status")),
                        "tsunami": optional_nonnegative_int(props.get("tsunami")),
                    },
                ), observed_at))
        except (KeyError, OSError, OverflowError, TypeError, ValueError):
            return schema_drift(self.source, snapshot)
        return completed(self.source, snapshot, events)
