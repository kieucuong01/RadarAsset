from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import urlencode

from smart_insights.event_contracts import EventCollectionBatch, EventInput
from smart_insights.event_normalization import normalize_event
from smart_insights.http import UrllibTransport
from smart_insights.sources import source_for_code

from .event_common import completed, fetch_event_json, optional_number, parse_iso_utc, required_str, schema_drift


_CATEGORY_MAP = {
    "wildfires": "wildfire",
    "severestorms": "severe storm",
    "volcanoes": "volcano",
    "floods": "flood",
    "earthquakes": "earthquake",
}


class EonetCollector:
    def __init__(self, *, transport: Any | None = None) -> None:
        self.source = source_for_code("nasa-eonet")
        self._transport = transport or UrllibTransport()

    def collect(self, *, observed_at: datetime) -> EventCollectionBatch:
        query = urlencode({"status": "open", "days": "7", "limit": "200"})
        request_url = f"{self.source.urls[0]}?{query}"
        fetched = fetch_event_json(source=self.source, transport=self._transport, request_url=request_url, observed_at=observed_at)
        if isinstance(fetched, EventCollectionBatch):
            return fetched
        snapshot, payload = fetched
        try:
            rows = payload["events"] if isinstance(payload, dict) else None
            if not isinstance(rows, list) or len(rows) > 200:
                raise ValueError("rows")
            events = []
            for raw in rows:
                if not isinstance(raw, dict):
                    raise ValueError("row")
                categories, geometries, sources = raw.get("categories"), raw.get("geometry"), raw.get("sources")
                if not isinstance(categories, list) or not categories or not isinstance(categories[0], dict):
                    raise ValueError("categories")
                if not isinstance(geometries, list) or not geometries or not isinstance(sources, list):
                    raise ValueError("geometry")
                geometry = geometries[-1]
                if not isinstance(geometry, dict) or geometry.get("type") != "Point":
                    raise ValueError("geometry")
                coords = geometry.get("coordinates")
                if not isinstance(coords, list) or len(coords) != 2:
                    raise ValueError("coordinates")
                category_id = required_str(categories[0].get("id"))
                source_ids = [required_str(item.get("id")) for item in sources if isinstance(item, dict)]
                if len(source_ids) != len(sources):
                    raise ValueError("sources")
                magnitude = optional_number(geometry.get("magnitudeValue"))
                events.append(normalize_event(EventInput(
                    source_code=self.source.code,
                    source_event_key=required_str(raw.get("id")),
                    category=_CATEGORY_MAP.get(category_id.casefold(), "other"),
                    subcategory=category_id,
                    title=required_str(raw.get("title")),
                    occurred_at=parse_iso_utc(geometry.get("date")),
                    provider_severity=None,
                    country=None,
                    region=None,
                    latitude=float(coords[1]),
                    longitude=float(coords[0]),
                    affected_count=None,
                    fatalities=None,
                    source_url=required_str(raw.get("link")),
                    dimensions={
                        "magnitude_value": magnitude,
                        "magnitude_unit": geometry.get("magnitudeUnit") if isinstance(geometry.get("magnitudeUnit"), str) else None,
                        "provider_sources": source_ids,
                    },
                    quality_flags=("provider_magnitude_not_comparable",) if magnitude is not None else (),
                ), observed_at))
        except (KeyError, TypeError, ValueError):
            return schema_drift(self.source, snapshot)
        return completed(self.source, snapshot, events)
