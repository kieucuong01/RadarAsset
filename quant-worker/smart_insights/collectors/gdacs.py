from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode

from smart_insights.event_contracts import EventCollectionBatch, EventInput
from smart_insights.event_normalization import normalize_event
from smart_insights.http import UrllibTransport
from smart_insights.sources import source_for_code

from .event_common import completed, fetch_event_json, parse_iso_utc, required_str, schema_drift


_EVENT_TYPES = {"EQ": "earthquake", "FL": "flood", "TC": "severe storm", "VO": "volcano", "WF": "wildfire", "DR": "other"}


class GdacsCollector:
    def __init__(self, *, transport: Any | None = None) -> None:
        self.source = source_for_code("gdacs-events")
        self._transport = transport or UrllibTransport()

    def collect(self, *, observed_at: datetime) -> EventCollectionBatch:
        start = (observed_at - timedelta(days=7)).date()
        query = urlencode(
            {
                "eventlist": "EQ;FL;TC;VO;WF;DR",
                "fromdate": start.isoformat(),
                "todate": observed_at.date().isoformat(),
                "alertlevel": "green;orange;red",
                "limit": "100",
            },
            safe=";",
        )
        request_url = f"{self.source.urls[0]}?{query}"
        fetched = fetch_event_json(source=self.source, transport=self._transport, request_url=request_url, observed_at=observed_at)
        if isinstance(fetched, EventCollectionBatch):
            return fetched
        snapshot, payload = fetched
        try:
            rows = payload["features"] if isinstance(payload, dict) and payload.get("type") == "FeatureCollection" else None
            if not isinstance(rows, list) or len(rows) > 100:
                raise ValueError("rows")
            events = []
            for raw in rows:
                if not isinstance(raw, dict) or raw.get("type") != "Feature":
                    raise ValueError("row")
                props, geometry = raw.get("properties"), raw.get("geometry")
                if not isinstance(props, dict) or not isinstance(geometry, dict) or geometry.get("type") != "Point":
                    raise ValueError("feature")
                coords = geometry.get("coordinates")
                if not isinstance(coords, list) or len(coords) < 2:
                    raise ValueError("coordinates")
                event_type = required_str(props.get("eventtype")).upper()
                event_id = props.get("eventid")
                if isinstance(event_id, bool) or not isinstance(event_id, (str, int)):
                    raise ValueError("eventid")
                url_value = props.get("url")
                report_url = url_value.get("report") if isinstance(url_value, dict) else url_value
                alert = required_str(props.get("alertlevel"))
                events.append(normalize_event(EventInput(
                    source_code=self.source.code,
                    source_event_key=f"{event_type}:{event_id}",
                    category=_EVENT_TYPES.get(event_type, "other"),
                    subcategory=event_type,
                    title=required_str(props.get("name")),
                    occurred_at=parse_iso_utc(props.get("fromdate")),
                    provider_severity=None,
                    country=props.get("country") if isinstance(props.get("country"), str) else None,
                    region=None,
                    latitude=float(coords[1]),
                    longitude=float(coords[0]),
                    affected_count=None,
                    fatalities=None,
                    source_url=required_str(report_url),
                    dimensions={"alert_level": alert, "episode_id": str(props.get("episodeid", ""))},
                ), observed_at))
        except (KeyError, TypeError, ValueError):
            return schema_drift(self.source, snapshot)
        return completed(self.source, snapshot, events)
